import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type {
  AgentRow,
  BranchRow,
  DiskRow,
  CiState,
  EventRow,
  GitInfo,
  LimitRow,
  PrInfo,
  PrRow,
  SessionRow,
  SessionState,
  Snapshot,
  WorktreeRow,
} from '../types'
import {
  agentStateOf,
  bytes,
  cacheHitPct,
  callKey,
  changesBetween,
  crossedSteps,
  emptySeen,
  isDiskLow,
  limitLabel,
  LONG_TASK_MS,
  parseDf,
  parseShortstat,
  parseWindowsDisks,
  remember,
  riskyReason,
  runwayMs,
  stepLabel,
  stuckReason,
  summarizeAgent,
} from './monitor'
import type { AgentMeta, AgentSummary, CallMark, Sample } from './monitor'
import { pushActivity, registerDashPane } from './render'

const PANE = 'dev-dash'
const TICK_MS = 5000
const PR_EVERY_TICKS = 12
const STALE_MS = 90_000
// Same refs as ./render.tsx; defined here because the validator reads each module's atoms from its own source.
const snap = atom({ plugin: 'dev-dash', key: 'snap' } as const, null)
const activity = atom({ plugin: 'dev-dash', key: 'activity' } as const, [])
const paneOpen = atom({ plugin: 'dev-dash', key: 'paneOpen' } as const, false)

const lines = (s: string) => s.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
const pad = (n: number) => String(n).padStart(2, '0')

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}`
  return `${Math.floor(s / 86400)}d`
}

// Your PRs across every repository, not just the one the session sits in, from one
// GitHub search. The rollup state is the latest commit's combined CI result.
const PR_QUERY = `query($mine: String!, $review: String!) {
  mine: search(query: $mine, type: ISSUE, first: 20) { nodes { ...pr } }
  review: search(query: $review, type: ISSUE, first: 20) { nodes { ...pr } }
}
fragment pr on PullRequest {
  number title url createdAt
  repository { nameWithOwner }
  author { login }
  reviewDecision mergeable
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`

const ciOf = (state: string | undefined | null): CiState => {
  const s = (state ?? '').toUpperCase()
  if (!s) return 'none'
  if (s === 'FAILURE' || s === 'ERROR') return 'failing'
  if (s === 'PENDING' || s === 'EXPECTED') return 'pending'
  return 'passing'
}

type GhPr = {
  number?: number
  title?: string
  url?: string
  createdAt?: string
  repository?: { nameWithOwner?: string }
  author?: { login?: string } | null
  reviewDecision?: string | null
  mergeable?: string
  commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string } | null } }> }
}

const toRow = (p: GhPr): PrRow => ({
  number: p.number ?? 0,
  title: p.title ?? '',
  repo: (p.repository?.nameWithOwner ?? '').split('/').pop() ?? '',
  url: p.url ?? '',
  author: p.author?.login ?? '',
  ageDays: Math.floor((Date.now() - Date.parse(p.createdAt ?? '')) / 86_400_000) || 0,
  review: (p.reviewDecision || 'NONE').replace('_', ' ').toLowerCase(),
  ci: ciOf(p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
  conflicts: p.mergeable === 'CONFLICTING',
})

const ctx = {
  selfId: '',
  dir: '',
  registryDir: '',
  projectsDir: '',
  isOpen: false,
  ticks: 0,
  prs: null as PrInfo | null,
  alertsOn: true,
  seen: emptySeen(),
  isFirstLook: true,
  events: [] as EventRow[],
  limitSamples: new Map<string, Sample[]>(),
  limits: [] as LimitRow[],
  lastContextPct: null as number | null,
  calls: [] as CallMark[],
  edits: new Map<string, number>(),
  bandOn: true,
  risky: null as { label: string; at: number } | null,
  ctxTrend: [] as number[],
  cacheHit: null as number | null,
  disks: [] as DiskRow[],
  lowDisks: new Set<string>(),
  isWindows: false,
}

const RISKY_WINDOW_MS = 10 * 60_000
const DISK_EVERY_TICKS = 12
const SOUND = { asset: 'sounds/chime.wav' }

const EVENTS_KEPT = 30
const EDIT_WINDOW_MS = 30 * 60_000
const LIMIT_WINDOW_MS = 30 * 60_000
const AGENT_RECENT_MS = 30 * 60_000
const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const slugOf = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-')
const me = {
  id: '',
  name: '',
  app: '',
  hasPlugin: true,
  waitingFor: '',
  cwd: '',
  repo: '',
  branch: '',
  state: 'idle' as SessionState,
  stateSince: Date.now(),
  startedAt: Date.now(),
  lastTool: '',
  stuck: '',
  editing: [] as string[],
  risky: '',
  ctxTrend: [] as number[],
  cacheHitPct: null as number | null,
}

async function git($: Engine, args: string[]) {
  try {
    const r = await $.process.run(['git', ...args], { timeoutMs: 10_000 })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

async function heartbeat($: Engine) {
  if (!ctx.dir || !ctx.selfId) return
  let costUsd: number | null = null
  let contextPct: number | null = null
  const now = Date.now()
  try {
    const u = await $.session.usage()
    costUsd = u.cost?.usd ?? null
    contextPct = u.context.percent ?? null
    trackLimits(u.rateLimits, now)
  } catch {}
  for (const step of crossedSteps(ctx.lastContextPct, contextPct)) {
    note($, { at: now, tone: step >= 90 ? 'bad' : 'warn', text: `this session's context is at ${step}%${step >= 75 ? ': /compact soon' : ''}` }, step >= 75)
  }
  if (contextPct !== null) ctx.lastContextPct = contextPct
  for (const [file, at] of ctx.edits) if (now - at > EDIT_WINDOW_MS) ctx.edits.delete(file)
  me.editing = [...ctx.edits.keys()]
  me.risky = ctx.risky && now - ctx.risky.at < RISKY_WINDOW_MS ? ctx.risky.label : ''
  me.ctxTrend = ctx.ctxTrend
  me.cacheHitPct = ctx.cacheHit
  const row: SessionRow = { ...me, costUsd, contextPct, updatedAt: now }
  await $.fs.write(`${ctx.dir}/${ctx.selfId}.json`, JSON.stringify(row)).catch(() => undefined)
}

// Claude Code's own record of running sessions: one <pid>.json per process,
// written whether or not this plugin is loaded. Only *.json is read; the
// .key files beside them are not ours to touch.
type RegistryEntry = {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  name?: string
  nameSource?: string
  waitingFor?: string
  entrypoint?: string
  status?: string
  statusUpdatedAt?: number
  updatedAt?: number
}

const stateOf = (status: string | undefined): SessionState => {
  const s = (status ?? '').toLowerCase()
  if (/wait|permission|input|blocked|ask/.test(s)) return 'waiting'
  if (/busy|running|working|thinking/.test(s)) return 'running'
  return 'idle'
}

const appOf = (entrypoint: string | undefined) =>
  !entrypoint ? '' : entrypoint === 'claude-desktop' ? 'desktop' : entrypoint === 'cli' ? 'cli' : entrypoint.replace(/^claude-/, '')

const gitCache = new Map<string, { at: number; repo: string; branch: string }>()

// A readable name for sessions whose registry name is only derived from their
// folder ("2025-2a"): the AI title Claude Code writes into the transcript, else
// the last prompt. Only those two record types are kept; the rest is dropped.
const titleCache = new Map<string, { at: number; title: string }>()
const TITLE_TTL_MS = 60_000
const READ_LIMIT = 4 * 1024 * 1024 - 64 * 1024

const titleIn = (text: string) => {
  let title = ''
  let prompt = ''
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('-title"') && !line.includes('"last-prompt"')) continue
    try {
      const d = JSON.parse(line) as { type?: string; aiTitle?: string; customTitle?: string; lastPrompt?: string }
      if (d.type === 'custom-title' && d.customTitle) title = d.customTitle
      else if (d.type === 'ai-title' && d.aiTitle) title = d.aiTitle
      else if (d.type === 'last-prompt' && d.lastPrompt) prompt = d.lastPrompt
    } catch {}
  }
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

  return title ? tidy(title) : prompt ? `“${cut(tidy(prompt), 48)}”` : ''
}

async function titleOf($: Engine, reg: RegistryEntry): Promise<string> {
  const hit = titleCache.get(reg.sessionId)
  if (hit && Date.now() - hit.at < TITLE_TTL_MS) return hit.title
  const path = `${ctx.projectsDir}/${reg.cwd.replace(/[^A-Za-z0-9]/g, '-')}/${reg.sessionId}.jsonl`
  let title = ''
  try {
    const stat = await $.fs.stat(path)
    if (stat.size <= READ_LIMIT) {
      title = titleIn(await $.fs.read(path))
    } else {
      for (const argv of [
        ['grep', '-a', '-F', '-e', '-title"', '-e', '"last-prompt"', path],
        ['findstr', '/L', 'ai-title custom-title last-prompt', path],
      ]) {
        try {
          const r = await $.process.run(argv, { timeoutMs: 10_000 })
          if (r.exitCode === 0) {
            title = titleIn(r.stdout)
            break
          }
        } catch {}
      }
    }
  } catch {}
  titleCache.set(reg.sessionId, { at: Date.now(), title })

  return title
}

async function livePids($: Engine): Promise<Set<number> | null> {
  try {
    const r = await $.process.run(['tasklist', '/FO', 'CSV', '/NH'], { timeoutMs: 10_000 })
    if (r.exitCode === 0) {
      return new Set(lines(r.stdout).map(l => Number(l.split('","')[1])).filter(n => n > 0))
    }
  } catch {}
  try {
    const r = await $.process.run(['ps', '-A', '-o', 'pid='], { timeoutMs: 10_000 })
    if (r.exitCode === 0) return new Set(lines(r.stdout).map(Number).filter(n => n > 0))
  } catch {}

  return null
}

async function whereIs($: Engine, cwd: string) {
  const hit = gitCache.get(cwd)
  if (hit && Date.now() - hit.at < 30_000) return hit
  const [top, branch] = await Promise.all([
    git($, ['-C', cwd, 'rev-parse', '--show-toplevel']),
    git($, ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']),
  ])
  const found = { at: Date.now(), repo: base(top?.trim() || cwd), branch: branch?.trim() || '' }
  gitCache.set(cwd, found)

  return found
}

async function readHeartbeats($: Engine): Promise<Map<string, SessionRow>> {
  const entries = await $.fs.list(ctx.dir).catch(() => [])
  const now = Date.now()
  const beats = new Map<string, SessionRow>()
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    if (f.mtimeMs > 0 && now - f.mtimeMs > STALE_MS) continue
    try {
      const row = JSON.parse(await $.fs.read(`${ctx.dir}/${f.name}`)) as SessionRow
      if (row.id && row.state !== 'ended' && now - row.updatedAt < STALE_MS) beats.set(row.id, row)
    } catch {}
  }

  return beats
}

async function readSessions($: Engine): Promise<SessionRow[]> {
  const [entries, alive, beats] = await Promise.all([
    $.fs.list(ctx.registryDir).catch(() => []),
    livePids($),
    readHeartbeats($),
  ])
  const rows: SessionRow[] = []
  const seen = new Set<string>()
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    let reg: RegistryEntry
    try {
      reg = JSON.parse(await $.fs.read(`${ctx.registryDir}/${f.name}`)) as RegistryEntry
    } catch {
      continue
    }
    if (!reg.sessionId || seen.has(reg.sessionId)) continue
    if (alive && !alive.has(reg.pid)) continue
    seen.add(reg.sessionId)
    const beat = beats.get(reg.sessionId)
    const where = beat?.branch ? { repo: beat.repo, branch: beat.branch } : await whereIs($, reg.cwd)
    const isDerived = !reg.name || reg.nameSource === 'derived'
    const name = (isDerived ? await titleOf($, reg) : '') || reg.name || ''
    rows.push({
      id: reg.sessionId,
      name,
      waitingFor: reg.status === 'waiting' || beat?.state === 'waiting' ? (reg.waitingFor ?? '') : '',
      app: appOf(reg.entrypoint),
      hasPlugin: beat !== undefined,
      cwd: reg.cwd,
      repo: where.repo,
      branch: where.branch,
      state: beat ? beat.state : stateOf(reg.status),
      stateSince: beat?.stateSince ?? reg.statusUpdatedAt ?? reg.startedAt,
      startedAt: reg.startedAt,
      lastTool: beat?.lastTool ?? '',
      costUsd: beat?.costUsd ?? null,
      contextPct: beat?.contextPct ?? null,
      updatedAt: beat?.updatedAt ?? reg.updatedAt ?? reg.startedAt,
      stuck: beat?.stuck ?? '',
      editing: beat?.editing ?? [],
      risky: beat?.risky ?? '',
      ctxTrend: beat?.ctxTrend ?? [],
      cacheHitPct: beat?.cacheHitPct ?? null,
    })
  }
  for (const beat of beats.values()) {
    if (!seen.has(beat.id)) rows.push(beat)
  }
  const order: Record<SessionState, number> = { waiting: 0, running: 1, idle: 2, ended: 3 }

  return rows.sort((a, b) => order[a.state] - order[b.state] || b.startedAt - a.startedAt)
}

// ---------------------------------------------------------------------------
// Monitoring: limits, events and alerts
// ---------------------------------------------------------------------------
function trackLimits(readings: ReadonlyArray<{ kind: string; percentUsed: number; resetsAt?: string }>, now: number) {
  ctx.limits = readings.map(r => {
    const kept = [...(ctx.limitSamples.get(r.kind) ?? []), { at: now, pct: r.percentUsed }].filter(s => now - s.at <= LIMIT_WINDOW_MS)
    // A reset drops the percentage: start the pace over from there.
    const resetAt = kept.findLastIndex((s, i) => i > 0 && s.pct < kept[i - 1].pct)
    const fromReset = resetAt > 0 ? kept.slice(resetAt) : kept
    ctx.limitSamples.set(r.kind, fromReset)
    const resetsAt = r.resetsAt ? Date.parse(r.resetsAt) : NaN
    return { kind: limitLabel(r.kind), pct: r.percentUsed, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null, etaMs: runwayMs(fromReset) }
  })
}

function note($: Engine, event: EventRow, isAlert: boolean) {
  ctx.events = [event, ...ctx.events].slice(0, EVENTS_KEPT)
  if (isAlert && ctx.alertsOn) {
    $.ui.toast(event.text, { timeoutMs: 6000 })
    // Plays where the host has a player (macOS terminals, the desktop app); silent elsewhere.
    void $.audio.play(SOUND).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Disk space, once a minute
// ---------------------------------------------------------------------------
async function readDisks($: Engine) {
  try {
    const r = ctx.isWindows
      ? await $.process.run(
          [
            'powershell',
            '-NoProfile',
            '-Command',
            'Get-PSDrive -PSProvider FileSystem | ForEach-Object { "$($_.Name) $([int64]$_.Free) $([int64]$_.Used)" }',
          ],
          { timeoutMs: 15_000 },
        )
      : await $.process.run(['df', '-Pk'], { timeoutMs: 10_000 })
    if (r.exitCode !== 0) return
    ctx.disks = ctx.isWindows ? parseWindowsDisks(r.stdout) : parseDf(r.stdout)
  } catch {
    return
  }
  const now = Date.now()
  for (const d of ctx.disks) {
    const isLow = isDiskLow(d)
    if (isLow && !ctx.lowDisks.has(d.name)) {
      note($, { at: now, tone: 'bad', text: `disk ${d.name} is low: ${bytes(d.freeBytes)} free` }, true)
    }
    if (isLow) ctx.lowDisks.add(d.name)
    else ctx.lowDisks.delete(d.name)
  }
}

// ---------------------------------------------------------------------------
// Agents: every live session's subagents, from the transcripts Claude Code keeps
// (<projects>/<slug>/<session>/subagents/agent-<id>.jsonl and .meta.json).
// ---------------------------------------------------------------------------
const agentCache = new Map<string, { stamp: string; sum: AgentSummary; meta: AgentMeta }>()

async function readAgents($: Engine, sessions: readonly SessionRow[]): Promise<AgentRow[]> {
  const now = Date.now()
  const rows: AgentRow[] = []
  for (const s of sessions) {
    const dir = `${ctx.projectsDir}/${slugOf(s.cwd)}/${s.id}/subagents`
    const entries = await $.fs.list(dir).catch(() => [])
    const byName = new Map(entries.map(f => [f.name, f] as const))
    for (const f of entries) {
      const m = /^agent-(.+)\.jsonl$/.exec(f.name)
      if (!m || f.kind !== 'file') continue
      const id = m[1]
      const metaFile = byName.get(`agent-${id}.meta.json`)
      const lastActive = Math.max(f.mtimeMs, metaFile?.mtimeMs ?? 0)
      const stamp = `${f.mtimeMs}:${f.size}:${metaFile?.mtimeMs ?? 0}`
      let hit = agentCache.get(`${s.id}/${id}`)
      if (!hit || hit.stamp !== stamp) {
        let meta: AgentMeta = {}
        let sum: AgentSummary = { startedAt: null, steps: 0, doing: '', isFinished: false }
        try {
          if (metaFile) meta = JSON.parse(await $.fs.read(`${dir}/${metaFile.name}`)) as AgentMeta
        } catch {}
        try {
          if (f.size <= READ_LIMIT) sum = summarizeAgent(await $.fs.read(`${dir}/${f.name}`))
        } catch {}
        hit = { stamp, sum, meta }
        agentCache.set(`${s.id}/${id}`, hit)
      }
      const state = agentStateOf(hit.meta, hit.sum, lastActive, now, true)
      if ((state === 'done' || state === 'stopped') && now - lastActive > AGENT_RECENT_MS) continue
      rows.push({
        id,
        sessionId: s.id,
        sessionName: s.name || s.repo,
        type: hit.meta.agentType ?? 'agent',
        description: hit.meta.description || 'subagent',
        state,
        isBackground: hit.meta.requestShape === 'background',
        startedAt: hit.sum.startedAt ?? lastActive,
        lastActive,
        doing: hit.sum.doing,
        steps: hit.sum.steps,
      })
    }
  }
  const order = { working: 0, quiet: 1, done: 2, stopped: 3 } as const

  return rows.sort((a, b) => order[a.state] - order[b.state] || b.lastActive - a.lastActive)
}

async function readGit($: Engine): Promise<GitInfo | null> {
  const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim()
  if (!branch) return null
  const [status, counts, stash, head, refs, wt, diff] = await Promise.all([
    git($, ['status', '--porcelain']),
    git($, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
    git($, ['stash', 'list']),
    git($, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
    git($, ['for-each-ref', '--sort=-committerdate', '--count=8', '--format=%(refname:short)|%(committerdate:relative)', 'refs/heads']),
    git($, ['worktree', 'list', '--porcelain']),
    git($, ['diff', '--shortstat', 'HEAD']),
  ])
  const [behind, ahead] = counts ? counts.trim().split(/\s+/).map(Number) : [0, 0]
  const baseRef = head?.trim().replace(/^origin\//, '') || 'main'
  const merged = new Set(lines((await git($, ['branch', '--merged', baseRef, '--format=%(refname:short)'])) ?? ''))
  const branches: BranchRow[] = lines(refs ?? '').map(l => {
    const [name, age] = l.split('|')
    return { name, age: (age ?? '').replace(' ago', ''), isMerged: merged.has(name) && name !== baseRef && name !== branch }
  })
  const worktrees: WorktreeRow[] = []
  for (const l of lines(wt ?? '')) {
    if (l.startsWith('worktree ')) worktrees.push({ path: l.slice(9), branch: '(detached)' })
    else if (l.startsWith('branch ') && worktrees.length > 0) {
      worktrees[worktrees.length - 1].branch = l.slice(7).replace('refs/heads/', '')
    }
  }

  return {
    branch,
    upstream: counts !== null,
    ahead: ahead || 0,
    behind: behind || 0,
    dirty: lines(status ?? '').length,
    stashes: lines(stash ?? '').length,
    base: baseRef,
    branches,
    worktrees,
    ...parseShortstat(diff ?? ''),
  }
}

async function readPrs($: Engine): Promise<PrInfo> {
  try {
    const r = await $.process.run(
      [
        'gh',
        'api',
        'graphql',
        '-f',
        `query=${PR_QUERY}`,
        '-f',
        'mine=is:pr is:open author:@me archived:false',
        '-f',
        'review=is:pr is:open review-requested:@me archived:false',
      ],
      { timeoutMs: 20_000 },
    )
    if (r.exitCode !== 0) throw new Error(lines(r.stderr)[0] ?? 'gh failed')
    const data = (JSON.parse(r.stdout) as { data?: { mine?: { nodes?: GhPr[] }; review?: { nodes?: GhPr[] } } }).data
    const keep = (nodes: GhPr[] | undefined) => (nodes ?? []).filter(p => typeof p.number === 'number').map(toRow)
    return {
      error: null,
      mine: keep(data?.mine?.nodes),
      toReview: keep(data?.review?.nodes).sort((a, b) => b.ageDays - a.ageDays),
      fetchedAt: Date.now(),
    }
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    const error = /ENOENT|not found|cannot start|not recognized/i.test(msg)
      ? 'gh CLI not found: install it, then run gh auth login'
      : cut(msg, 70)
    return { error, mine: [], toReview: [], fetchedAt: Date.now() }
  }
}

async function publish($: Engine, gitInfo: GitInfo | null | undefined, sample = false) {
  const sessions = await readSessions($)
  const agents = await readAgents($, sessions)
  if (sample) await update($, activity, h => pushActivity(h, sessions))
  const now = Date.now()
  const mine = ctx.prs && !ctx.prs.error ? ctx.prs.mine : null
  for (const c of changesBetween(ctx.seen, sessions, agents, mine, ctx.selfId, now, ctx.isFirstLook)) {
    note($, { at: c.at, tone: c.tone, text: c.text }, c.isAlert)
  }
  ctx.seen = remember(sessions, agents, mine)
  ctx.isFirstLook = false
  await update($, snap, s => {
    const next: Snapshot = {
      selfId: ctx.selfId,
      sessions,
      agents,
      limits: ctx.limits,
      events: ctx.events,
      alertsOn: ctx.alertsOn,
      bandOn: ctx.bandOn,
      paneOpen: ctx.isOpen,
      disks: ctx.disks,
      git: gitInfo === undefined ? (s?.git ?? null) : gitInfo,
      prs: ctx.prs,
      updatedAt: Date.now(),
    }
    return next
  })
}

async function setState($: Engine, state: SessionState) {
  if (me.state === state) return
  me.state = state
  me.stateSince = Date.now()
  await heartbeat($)
  await publish($, undefined)
}

async function tick($: Engine, withPrs: boolean) {
  const g = await readGit($)
  if (g) me.branch = g.branch
  await heartbeat($)
  if (withPrs) ctx.prs = await readPrs($)
  if (ctx.ticks % DISK_EVERY_TICKS === 0) await readDisks($)
  await publish($, g, true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    ctx.selfId = await $.session.id()
    const home = ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/')
    const config = ((await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`).replace(/\\/g, '/')
    ctx.dir = `${config}/dev-dash/sessions`
    ctx.registryDir = `${config}/sessions`
    ctx.projectsDir = `${config}/projects`
    me.id = ctx.selfId
    me.cwd = await $.session.cwd()
    const top = (await git($, ['rev-parse', '--show-toplevel']))?.trim()
    me.repo = base(top || me.cwd)
    try {
      me.startedAt = (await $.session.usage()).startedAt
    } catch {}

    await $.command.register({ name: 'dash', description: 'Open the developer dashboard pane' })
    await $.command.register({ name: 'dash-hide', description: 'Hide the developer dashboard pane' })
    await $.command.register({ name: 'dash-alerts', description: 'Turn dashboard toasts on or off (on | off, or toggle)' })
    await $.command.register({ name: 'dash-band', description: 'Show or hide the dev-dash line above the prompt (on | off, or toggle)' })
    const stored = await $.store.get('alertsOn').catch(() => undefined)
    if (typeof stored === 'boolean') ctx.alertsOn = stored
    const storedBand = await $.store.get('bandOn').catch(() => undefined)
    if (typeof storedBand === 'boolean') ctx.bandOn = storedBand
    await $.command.register({ name: 'dash-refresh', description: 'Refresh the dashboard now, PRs included' })
    ctx.isWindows = (await $.env.get('OS')) === 'Windows_NT'
    // A reload of the mod starts this module over; the host's state remembers the pane was open.
    ctx.isOpen = (await read($, paneOpen)) === true
    await tick($, ctx.isOpen)
    $.clock.every(TICK_MS, async () => {
      ctx.ticks += 1
      await tick($, ctx.isOpen && (ctx.prs === null || ctx.ticks % PR_EVERY_TICKS === 0))
    })

    return ran
  })

  on('session.end', async ($, e, next) => {
    me.state = 'ended'
    await heartbeat($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await setState($, 'running')

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    ctx.cacheHit = cacheHitPct(e.usage) ?? ctx.cacheHit
    try {
      const pct = (await $.session.usage()).context.percent
      if (typeof pct === 'number') ctx.ctxTrend = [...ctx.ctxTrend, Math.round(pct)].slice(-12)
    } catch {}
    if (!e.agentId && e.durationMs >= LONG_TASK_MS) {
      note($, { at: Date.now(), tone: 'ok', text: `this session finished a ${Math.round(e.durationMs / 60_000)}m task` }, true)
    }
    await setState($, 'idle')

    return ran
  })

  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (r.decision === 'ask') await setState($, 'waiting')

    return r
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    me.lastTool = stepLabel(e.tool, input)
    if (e.tool === 'AskUserQuestion') {
      await setState($, 'waiting')
      const r = await next(e)
      await setState($, 'running')
      return r
    }
    await setState($, 'running')
    if ((e.tool === 'Bash' || e.tool === 'PowerShell') && typeof input.command === 'string') {
      const label = riskyReason(input.command)
      if (label) ctx.risky = { label, at: Date.now() }
    }
    if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(e.tool)) {
      const file = input.file_path ?? input.notebook_path
      if (typeof file === 'string') ctx.edits.set(normPath(file), Date.now())
    }

    let isOk = false
    try {
      const ran = await next(e)
      const shape = ran as { deny?: string; isError?: boolean; result?: { interrupted?: boolean } }
      isOk = !shape.deny && !shape.isError && !shape.result?.interrupted
      return ran
    } finally {
      ctx.calls = [...ctx.calls, { key: callKey(e.tool, input), label: stepLabel(e.tool, input), isOk, at: Date.now() }].slice(-20)
      me.stuck = stuckReason(ctx.calls)
    }
  })

  on('command.run', { command: 'dash-refresh' }, async $ => {
    titleCache.clear()
    gitCache.clear()
    await tick($, true)

    return { text: `Dashboard refreshed${ctx.prs?.error ? `; PRs: ${ctx.prs.error}` : ''}.` }
  })

  // Closed some other way (the pane's own close, or Claude Code itself): stop polling GitHub.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      ctx.isOpen = false
      await update($, paneOpen, () => false)
    }

    return next(e)
  })

  on('command.run', { command: 'dash-band' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    ctx.bandOn = arg === 'on' ? true : arg === 'off' ? false : !ctx.bandOn
    await $.store.set('bandOn', ctx.bandOn)
    await publish($, undefined)

    return { text: `Dashboard line above the prompt ${ctx.bandOn ? 'on' : 'off'}.` }
  })

  on('command.run', { command: 'dash-alerts' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    ctx.alertsOn = arg === 'on' ? true : arg === 'off' ? false : !ctx.alertsOn
    await $.store.set('alertsOn', ctx.alertsOn)
    await publish($, undefined)

    return { text: `Dashboard alerts ${ctx.alertsOn ? 'on' : 'off'}.` }
  })

  on('command.run', { command: 'dash' }, async $ => {
    ctx.isOpen = true
    await update($, paneOpen, () => true)
    await $.ui.open({ id: PANE, title: 'Dev dashboard' })
    if (ctx.disks.length === 0) void readDisks($)
    void tick($, true)

    return { text: 'Dashboard opened.' }
  })

  on('command.run', { command: 'dash-hide' }, async $ => {
    ctx.isOpen = false
    await update($, paneOpen, () => false)
    await $.ui.close({ id: PANE })
    await publish($, undefined)

    return { text: 'Dashboard hidden.' }
  })

  // The drawing lives in ./render.tsx (drop-in replacement for the old inline hook).
  registerDashPane(on, {
    onHide: () => {
      ctx.isOpen = false
    },
  })
}
