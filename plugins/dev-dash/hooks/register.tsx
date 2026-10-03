import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type {
  AgentRow,
  BranchRow,
  DiskRow,
  CiState,
  ChangedFile,
  EventRow,
  GitInfo,
  LimitRow,
  NowPlaying,
  PlanProgress,
  PrInfo,
  PrRow,
  SessionRow,
  SessionState,
  Snapshot,
  SourceRow,
  TestRun,
  IconStyle,
  WatchKind,
  WatchRow,
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
  SUMMARY_SYSTEM,
  summarizeAgent,
  summaryPrompt,
  tidySummary,
} from './monitor'
import type { AgentMeta, AgentSummary, CallMark, Sample } from './monitor'
import { runExe as runExeWith } from './exe'
import { HANDOFFS_KEPT, handoffName, handoffNote, staleNotes } from './handoff'
import { isTab, nowPlayingCommand, parseNowPlaying, unavailable } from './entertainment'
import type { Platform } from './entertainment'
import { isMuted } from './keys'
import { recapNow } from './recap-run'
import { DEFAULT_ICON_STYLE, ICON_STYLES, parseIconStyle } from './icons'
import { addSource, countLines, parseNumstat, planOf, sourceOf, TURN_FILES_KEPT } from './progress'
import { testRunOf } from './testrun'
import { pushActivity, registerDashPane } from './render'
import type { Reading } from './watch'
import {
  addWatch,
  clearWatches,
  isExpired,
  ISSUE_FIELDS,
  parseWatchArgs,
  pollable,
  PR_FIELDS,
  readIssue,
  readPr,
  readRun,
  RUN_FIELDS,
  stepWatch,
  WATCH_EVERY_MS,
  WATCH_HELP,
  watchName,
} from './watch'

const PANE = 'dev-dash'
const TICK_MS = 5000
const PR_EVERY_TICKS = 12
const STALE_MS = 90_000
// Same refs as ./render.tsx; defined here because the validator reads each module's atoms from its own source.
const snap = atom({ plugin: 'dev-dash', key: 'snap' } as const, null)
const activity = atom({ plugin: 'dev-dash', key: 'activity' } as const, [])
const paneOpen = atom({ plugin: 'dev-dash', key: 'paneOpen' } as const, false)
const snoozed = atom({ plugin: 'dev-dash', key: 'snoozed' } as const, {})
const tab = atom({ plugin: 'dev-dash', key: 'tab' } as const, 'dashboard')
const dismissed = atom({ plugin: 'dev-dash', key: 'dismissed' } as const, [])

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
  handoffDir: '',
  handoffOn: true,
  registryDir: '',
  root: '',
  projectsDir: '',
  isOpen: false,
  ticks: 0,
  prs: null as PrInfo | null,
  alertsOn: true,
  seen: emptySeen(),
  isFirstLook: true,
  events: [] as EventRow[],
  limitSamples: new Map<string, Sample[]>(),
  /** Tool calls this session made since the last claude beat sample. */
  toolCalls: 0,
  limits: [] as LimitRow[],
  lastContextPct: null as number | null,
  calls: [] as CallMark[],
  edits: new Map<string, number>(),
  bandOn: true,
  summariesOn: false,
  isSummarizing: false,
  lastPrompt: '',
  risky: null as { label: string; at: number } | null,
  ctxTrend: [] as number[],
  cacheHit: null as number | null,
  disks: [] as DiskRow[],
  lowDisks: new Set<string>(),
  isWindows: false,
  platform: 'linux' as Platform,
  nowPlaying: null as NowPlaying | null,
  nowPlayingAt: 0,
  plan: null as PlanProgress | null,
  planAt: 0,
  sources: [] as SourceRow[],
  turnEdits: new Map<string, string>(),
  turnFiles: [] as ChangedFile[],
  lastTest: null as TestRun | null,
  watches: [] as WatchRow[],
  watchPolledAt: 0,
  iconStyle: DEFAULT_ICON_STYLE as IconStyle,
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
  summary: '',
  plan: null as PlanProgress | null,
  planAt: 0,
  sources: [] as SourceRow[],
  turnFiles: [] as ChangedFile[],
  lastTest: null as TestRun | null,
}

// Run `git` or `gh`. The process Claude Code runs in can have an older PATH than the machine: an app that was
// started before they were installed keeps its old environment until it is restarted. So if the program cannot be
// started on Windows, try its standard install folder before giving up, and remember whichever worked.
// What could go wrong: the fallback paths are fixed strings under %ProgramFiles%, the arguments are passed as an
// array with no shell, and a path that stops working is forgotten and looked up again.
const WINDOWS_INSTALLS: Record<'git' | 'gh', (programFiles: string) => string[]> = {
  gh: pf => [`${pf}\\GitHub CLI\\gh.exe`],
  git: pf => [`${pf}\\Git\\cmd\\git.exe`, `${pf}\\Git\\bin\\git.exe`],
}
const exeFound = new Map<string, string>()

// The lookup logic is in exe.ts (it tells a timeout from a program that is not there by how long the call ran, since
// the API gives no wording for either); this wires it to the engine.
const runExe = ($: Engine, name: 'git' | 'gh', args: string[], timeoutMs: number) =>
  runExeWith({
    run: (argv, timeout) => $.process.run(argv, { timeoutMs: timeout }),
    name,
    args,
    timeoutMs,
    found: exeFound,
    fallbacks: async () => {
      const programFiles = (await $.env.get('OS')) === 'Windows_NT' ? await $.env.get('ProgramFiles') : undefined

      return programFiles ? WINDOWS_INSTALLS[name](programFiles) : []
    },
  })

async function git($: Engine, args: string[]) {
  try {
    const r = await runExe($, 'git', args, 10_000)
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
  me.plan = ctx.plan
  me.planAt = ctx.planAt
  me.sources = ctx.sources
  me.turnFiles = ctx.turnFiles
  me.lastTest = ctx.lastTest
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
      summary: beat?.summary ?? '',
      plan: beat?.plan ?? null,
      planAt: beat?.planAt ?? 0,
      sources: beat?.sources ?? [],
      turnFiles: beat?.turnFiles ?? [],
      lastTest: beat?.lastTest ?? null,
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

const runGh = ($: Engine, args: string[], timeoutMs: number) => runExe($, 'gh', args, timeoutMs)

async function readPrs($: Engine): Promise<PrInfo> {
  try {
    const r = await runGh(
      $,
      [
        'api',
        'graphql',
        '-f',
        `query=${PR_QUERY}`,
        '-f',
        'mine=is:pr is:open author:@me archived:false',
        '-f',
        'review=is:pr is:open review-requested:@me archived:false',
      ],
      20_000,
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

// One small model call after a finished turn; the label is written to this session's status file.
async function summarize($: Engine, answer: string) {
  if (!ctx.summariesOn || ctx.isSummarizing) return
  ctx.isSummarizing = true
  try {
    const r = await $.model.complete({
      model: 'haiku',
      system: SUMMARY_SYSTEM,
      prompt: summaryPrompt(ctx.lastPrompt, answer, ctx.calls.map(c => c.label)),
      maxTokens: 40,
      timeoutMs: 20_000,
    })
    if (r.isAnswered) {
      me.summary = tidySummary(r.text)
      await heartbeat($)
      await publish($, undefined)
    }
  } catch {
    // A failed label is not worth an alert; the next turn tries again.
  } finally {
    ctx.isSummarizing = false
  }
}

// A refresh that fails must never stop a command from answering or a hook from finishing. The error is
// written to ~/.claude/dev-dash/last-error.txt (and only the latest), so a failure can be read afterwards.
async function logError($: Engine, where: string, err: unknown) {
  try {
    if (!ctx.root) return
    const detail = String((err as Error)?.stack ?? err).slice(0, 1500)
    await $.fs.write(`${ctx.root}/last-error.txt`, `${new Date().toISOString()} ${where}\n${detail}\n`)
  } catch {}
}

async function publishNow($: Engine, gitInfo: GitInfo | null | undefined, sample = false) {
  const sessions = await readSessions($)
  const agents = await readAgents($, sessions)
  if (sample) {
    const calls = ctx.toolCalls
    ctx.toolCalls = 0
    await update($, activity, h => pushActivity(h, sessions, agents, calls))
  }
  const now = Date.now()
  const mine = ctx.prs && !ctx.prs.error ? ctx.prs.mine : null
  const muting = { snoozed: (await read($, snoozed)) ?? {}, dismissed: (await read($, dismissed)) ?? [], now }
  for (const c of changesBetween(ctx.seen, sessions, agents, mine, ctx.selfId, now, ctx.isFirstLook)) {
    // A row you snoozed or dismissed in the pane stays in the feed but stops making noise.
    const isMutedRow = c.itemId !== undefined && isMuted(muting, c.itemId)
    note($, { at: c.at, tone: c.tone, text: c.text }, c.isAlert && !isMutedRow)
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
      summariesOn: ctx.summariesOn,
      paneOpen: ctx.isOpen,
      disks: ctx.disks,
      nowPlaying: ctx.nowPlaying,
      git: gitInfo === undefined ? (s?.git ?? null) : gitInfo,
      prs: ctx.prs,
      watches: ctx.watches,
      iconStyle: ctx.iconStyle,
      updatedAt: Date.now(),
    }
    return next
  })
}

async function publish($: Engine, gitInfo: GitInfo | null | undefined, sample = false) {
  try {
    await publishNow($, gitInfo, sample)
  } catch (err) {
    await logError($, 'publish', err)
  }
}

async function setState($: Engine, state: SessionState) {
  if (me.state === state) return
  me.state = state
  me.stateSince = Date.now()
  await heartbeat($)
  await publish($, undefined)
}

// Files this turn edited, with lines added/removed against HEAD. A file git has no diff for
// but lists as untracked is new: all of its lines count as added.
async function readTurnFiles($: Engine): Promise<ChangedFile[]> {
  const files: ChangedFile[] = []
  for (const file of [...ctx.turnEdits.values()].slice(-TURN_FILES_KEPT)) {
    const out = await git($, ['diff', '--numstat', 'HEAD', '--', file])
    // git could not answer (not found, not a repository, or the file is outside one): the file was still edited
    // this turn, so it is listed, with its line counts marked as unknown rather than left out.
    if (out === null) {
      files.push({ path: file, added: 0, removed: 0, counted: false })
      continue
    }
    const diff = parseNumstat(out)[0]
    if (diff) {
      files.push({ path: file, added: diff.added, removed: diff.removed })
      continue
    }
    const isNew = ((await git($, ['ls-files', '--others', '--exclude-standard', '--', file])) ?? '').trim() !== ''
    if (!isNew) continue
    try {
      files.push({ path: file, added: countLines(await $.fs.read(file)), removed: 0 })
    } catch {}
  }

  return files
}

// Keep only the newest HANDOFFS_KEPT notes. There is no delete in the file API, so this asks the OS;
// staleNotes only ever names files that look exactly like the ones we write.
async function pruneHandoffs($: Engine) {
  const entries = await $.fs.list(ctx.handoffDir).catch(() => [])
  for (const name of staleNotes(entries.filter(f => f.kind === 'file').map(f => f.name))) {
    // Run in the notes folder and pass only the bare name (it has matched NOTE_NAME: no spaces, separators,
    // wildcards or leading dash). Passing a full path through cmd's re-parsing is what could split on a
    // home directory with a space.
    await $.process
      .run(ctx.isWindows ? ['cmd', '/c', 'del', '/q', name] : ['rm', '-f', name], { cwd: ctx.handoffDir, timeoutMs: 10_000 })
      .catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// /dash-watch: pull requests the person asked to keep an eye on
// ---------------------------------------------------------------------------
const isWatchRow = (v: unknown): v is WatchRow =>
  !!v && typeof v === 'object' && typeof (v as WatchRow).id === 'string' && typeof (v as WatchRow).number === 'number' && typeof (v as WatchRow).repo === 'string'

// The list lives in the plugin store, so every session sees the same one; each cycle starts from it.
async function loadWatches($: Engine): Promise<WatchRow[]> {
  const v = await $.store.get('watches').catch(() => undefined)

  return Array.isArray(v) ? v.filter(isWatchRow) : []
}

// How each kind is read: the gh subcommand, the fields asked for, and the function that turns the answer into a reading.
const GH_READ: Record<WatchKind, { args: string[]; fields: string; read: (json: unknown) => Reading | null }> = {
  pr: { args: ['pr', 'view'], fields: PR_FIELDS, read: readPr },
  issue: { args: ['issue', 'view'], fields: ISSUE_FIELDS, read: readIssue },
  run: { args: ['run', 'view'], fields: RUN_FIELDS, read: readRun },
}

async function readWatch($: Engine, w: WatchRow) {
  const g = GH_READ[w.kind] ?? GH_READ.pr
  try {
    const r = await runGh($, [...g.args, String(w.number), '--repo', w.repo, '--json', g.fields], 20_000)
    return r.exitCode === 0 ? g.read(JSON.parse(r.stdout)) : null
  } catch {
    return null
  }
}

// One look at every live watch: no faster than WATCH_EVERY_MS unless forced (adding a watch takes its baseline).
// A change after the baseline fires the watch: a line in the event feed and a mark in the section. Never a toast.
async function pollWatches($: Engine, force: boolean) {
  const now = Date.now()
  if (!force && now - ctx.watchPolledAt < WATCH_EVERY_MS) return
  ctx.watchPolledAt = now
  let list = (await loadWatches($)).filter(w => !isExpired(w, now))
  for (const w of pollable(list, now)) {
    const r = await readWatch($, w)
    if (!r) continue
    const next = stepWatch(w, r, now)
    if (next.firedAt > w.firedAt) {
      const tone = /failing|failed|conflict/.test(next.fired) ? 'bad' : /merged|passed|ready/.test(next.fired) ? 'ok' : 'info'
      note($, { at: now, tone, text: `watch ${watchName(w)} ${w.repo}: ${next.fired}` }, false)
    }
    list = list.map(x => (x.id === w.id ? next : x))
  }
  ctx.watches = list
  await $.store.set('watches', list).catch(() => undefined)
}

async function tick($: Engine, withPrs: boolean) {
  try {
    await tickNow($, withPrs)
  } catch (err) {
    await logError($, 'tick', err)
  }
}

// What Spotify on this machine is playing, read with a local command. Only while the pane is open and the
// Entertainment tab is the one showing, and no more often than every few seconds.
async function readNowPlaying($: Engine) {
  const now = Date.now()
  if (now - ctx.nowPlayingAt < 4000) return
  ctx.nowPlayingAt = now
  try {
    const r = await $.process.run(nowPlayingCommand(ctx.platform), { timeoutMs: 8000 })
    ctx.nowPlaying = parseNowPlaying(ctx.platform, r.stdout, r.exitCode, now)
  } catch {
    ctx.nowPlaying = unavailable(now)
  }
}

async function tickNow($: Engine, withPrs: boolean) {
  const g = await readGit($)
  if (g) me.branch = g.branch
  // Only while a turn runs: turn.complete already took the final numbers, and an idle session
  // should not keep spawning git for files it edited minutes ago.
  if (me.state === 'running' && ctx.turnEdits.size > 0) ctx.turnFiles = await readTurnFiles($)
  await heartbeat($)
  if (withPrs) ctx.prs = await readPrs($)
  if (ctx.isOpen) {
    const showing = await read($, tab)
    if (isTab(showing) && showing === 'entertainment') await readNowPlaying($)
  }
  // The list is read from the store inside, so a watch another session added is picked up too.
  if (ctx.isOpen) await pollWatches($, false)
  if (ctx.ticks % DISK_EVERY_TICKS === 0) await readDisks($)
  await publish($, g, true)
}

// What `a`, `r` and `q` do. The typed commands and the footer keys run the same code. (A plugin cannot run its
// own slash commands through $.command.run, which skips the calling plugin's hooks, so the keys call these.)
async function setAlerts($: Engine, arg: string) {
  const a = arg.trim().toLowerCase()
  ctx.alertsOn = a === 'on' ? true : a === 'off' ? false : !ctx.alertsOn
  await $.store.set('alertsOn', ctx.alertsOn).catch(() => undefined)
  await publish($, undefined)

  return `Dashboard alerts ${ctx.alertsOn ? 'on' : 'off'}.`
}

async function refreshNow($: Engine) {
  titleCache.clear()
  gitCache.clear()
  await tick($, true)

  return `Dashboard refreshed${ctx.prs?.error ? `; PRs: ${ctx.prs.error}` : ''}.`
}

async function closePane($: Engine) {
  ctx.isOpen = false
  await update($, paneOpen, () => false)
  await $.ui.close({ id: PANE })
  await publish($, undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    ctx.selfId = await $.session.id()
    const home = ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/')
    const config = ((await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`).replace(/\\/g, '/')
    ctx.root = `${config}/dev-dash`
    ctx.dir = `${config}/dev-dash/sessions`
    ctx.handoffDir = `${config}/dev-dash/handoffs`
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
    await $.command.register({ name: 'dash-summaries', description: 'Write a one-line summary per session after each turn (on | off; uses a small model call per turn)' })
    const storedSummaries = await $.store.get('summariesOn').catch(() => undefined)
    if (typeof storedSummaries === 'boolean') ctx.summariesOn = storedSummaries
    await $.command.register({ name: 'dash-icons', description: 'Icons in the Watching boxes: emoji (any font, default) | nerd (the official GitHub mark, needs a Nerd Font) | ascii' })
    const storedIcons = parseIconStyle(String(await $.store.get('iconStyle').catch(() => '')))
    if (storedIcons) ctx.iconStyle = storedIcons
    await $.command.register({ name: 'dash-handoff', description: 'Write a handoff note when a session compacts (on | off, or toggle)' })
    const storedHandoff = await $.store.get('handoffOn').catch(() => undefined)
    if (typeof storedHandoff === 'boolean') ctx.handoffOn = storedHandoff
    await $.command.register({ name: 'dash-watch', description: 'Keep an eye on a pull request: pr <number or URL> | list | clear <number|all>' })
    ctx.watches = (await loadWatches($)).filter(w => !isExpired(w, Date.now()))
    await $.command.register({ name: 'dash-recap', description: 'Print a short recap of today: sessions and cost, your commits, PRs you merged' })
    await $.command.register({ name: 'dash-refresh', description: 'Refresh the dashboard now, PRs included' })
    ctx.isWindows = (await $.env.get('OS')) === 'Windows_NT'
    if (ctx.isWindows) ctx.platform = 'windows'
    else {
      const uname = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => undefined)
      ctx.platform = uname?.stdout.trim() === 'Darwin' ? 'mac' : 'linux'
    }
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
    ctx.turnEdits.clear()
    ctx.turnFiles = []
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
    if (ctx.turnEdits.size > 0) ctx.turnFiles = await readTurnFiles($)
    await setState($, 'idle')
    if (!e.agentId && !e.isAborted) void summarize($, e.answer)

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    ctx.lastPrompt = e.text

    return next(e)
  })

  on('command.run', { command: 'dash-summaries' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    ctx.summariesOn = arg === 'on' ? true : arg === 'off' ? false : !ctx.summariesOn
    await $.store.set('summariesOn', ctx.summariesOn)
    if (!ctx.summariesOn) me.summary = ''
    await heartbeat($)
    await publish($, undefined)

    return {
      text: ctx.summariesOn
        ? 'Session summaries on: one small Haiku call after each finished turn. Turn off with /dash-summaries off.'
        : 'Session summaries off.',
    }
  })

  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (r.decision === 'ask') await setState($, 'waiting')

    return r
  })

  on('tool.call', async ($, e, next) => {
    ctx.toolCalls += 1
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
      if (typeof file === 'string') {
        ctx.edits.set(normPath(file), Date.now())
        ctx.turnEdits.set(normPath(file), file)
      }
    }
    if (e.tool === 'TodoWrite') {
      const plan = planOf(input)
      if (plan) {
        ctx.plan = plan
        ctx.planAt = Date.now()
      }
    }
    const source = sourceOf(e.tool, input, Date.now())
    if (source) ctx.sources = addSource(ctx.sources, source)

    let isOk = false
    let wasCut = false
    try {
      const ran = await next(e)
      const shape = ran as { deny?: string; isError?: boolean; result?: { interrupted?: boolean } }
      isOk = !shape.deny && !shape.isError && !shape.result?.interrupted
      wasCut = !!shape.deny || !!shape.result?.interrupted
      return ran
    } finally {
      ctx.calls = [...ctx.calls, { key: callKey(e.tool, input), label: stepLabel(e.tool, input), isOk, at: Date.now() }].slice(-20)
      me.stuck = stuckReason(ctx.calls)
      // A test run's outcome. The result has no exit code field; a failing command comes back as an error.
      // A call that was denied or interrupted never finished a run, so it leaves the badge alone.
      if ((e.tool === 'Bash' || e.tool === 'PowerShell') && typeof input.command === 'string' && !wasCut) {
        ctx.lastTest = testRunOf(input.command, isOk, Date.now()) ?? ctx.lastTest
      }
    }
  })

  on('command.run', { command: 'dash-recap' }, async $ => ({
    text: await recapNow({
      dir: ctx.dir,
      cwd: me.cwd,
      fs: { list: dir => $.fs.list(dir), read: path => $.fs.read(path) },
      git: async args => {
        try {
          const r = await runExe($, 'git', args, 10_000)

          return r.exitCode === 0 ? r.stdout : null
        } catch {
          return null
        }
      },
      gh: async args => {
        try {
          const r = await runGh($, args, 20_000)

          return r.exitCode === 0 ? r.stdout : null
        } catch {
          return null
        }
      },
      now: Date.now(),
    }),
  }))

  on('command.run', { command: 'dash-refresh' }, async $ => ({ text: await refreshNow($) }))

  // The footer keys. The press is taken here, so the Button's own onPress (a no-op) never runs.
  on('ui.press', { plugin: 'dev-dash', element: 'key-refresh' }, async ($, e) => {
    await refreshNow($)

    return { element: e.element }
  })
  on('ui.press', { plugin: 'dev-dash', element: 'key-alerts' }, async ($, e) => {
    await setAlerts($, '')

    return { element: e.element }
  })
  on('ui.press', { plugin: 'dev-dash', element: 'key-close' }, async ($, e) => {
    await closePane($)

    return { element: e.element }
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

  on('command.run', { command: 'dash-alerts' }, async ($, e) => ({ text: await setAlerts($, e.args ?? '') }))

  on('command.run', { command: 'dash-watch' }, async ($, e) => {
    const cmd = parseWatchArgs(e.args ?? '')
    const now = Date.now()
    ctx.watches = (await loadWatches($)).filter(w => !isExpired(w, now))
    if (cmd.cmd === 'help') return { text: `${cmd.reason} ${WATCH_HELP}` }
    if (cmd.cmd === 'list') {
      const rows = ctx.watches.map((w, i) => `${i + 1}. ${watchName(w)} ${w.repo} · ${w.detail || 'waiting for the first look'}${w.firedAt ? ` · ${w.fired}` : ''}`)

      return { text: rows.length ? rows.join('\n') : `Nothing watched. ${WATCH_HELP}` }
    }
    if (cmd.cmd === 'clear') {
      const r = clearWatches(ctx.watches, cmd.which)
      ctx.watches = r.list
      await $.store.set('watches', r.list).catch(() => undefined)
      await publish($, undefined)

      return { text: r.removed ? `Cleared ${r.removed === 1 ? 'that watch' : `${r.removed} watches`}.` : 'No watch with that number. /dash-watch list shows them.' }
    }
    // Add. A bare number means this session's repository, as gh knows it.
    let spec = cmd.spec
    if (!spec.repo) {
      let name = ''
      try {
        const r = await runGh($, ['repo', 'view', '--json', 'nameWithOwner'], 15_000)
        if (r.exitCode === 0) name = String((JSON.parse(r.stdout) as { nameWithOwner?: string }).nameWithOwner ?? '')
      } catch {}
      if (!name) return { text: `I could not tell which repository #${spec.number} is in. Use owner/repo#${spec.number} or the GitHub URL.` }
      spec = { ...spec, repo: name }
    }
    const added = addWatch(ctx.watches, spec, now)
    if (added.error || !added.added) return { text: added.error }
    ctx.watches = added.list
    await $.store.set('watches', added.list).catch(() => undefined)
    await pollWatches($, true)
    await publish($, undefined)
    const w = ctx.watches.find(x => x.id === added.added?.id)

    // No reading yet means gh could not answer: not on PATH for this process, not logged in, or no such item.
    const unread = w?.detail ? '' : ` I could not read it just now: check that \`gh\` is installed, on your PATH and logged in (\`gh auth status\`), and that the ${spec.kind === 'pr' ? 'pull request' : spec.kind === 'issue' ? 'issue' : 'run'} exists. It will keep trying while the pane is open.`

    return { text: `Watching ${watchName(spec)} in ${spec.repo}${w?.detail ? ` (now ${w.detail})` : ''}. It is checked about once a minute while the dashboard pane is open, and drops off after 24 hours.${unread}` }
  })

  on('command.run', { command: 'dash-icons' }, async ($, e) => {
    const style = parseIconStyle(e.args ?? '')
    if (!style) {
      return { text: `Icons are ${ctx.iconStyle}. Choose one: ${ICON_STYLES.join(' | ')}. emoji works in any font; nerd draws the official GitHub mark and needs a Nerd Font set as your terminal font (nerdfonts.com), or it shows as an empty box; ascii is plain letters.` }
    }
    ctx.iconStyle = style
    await $.store.set('iconStyle', style).catch(() => undefined)
    await publish($, undefined)

    return { text: `Icons: ${style}.${style === 'nerd' ? ' If the GitHub mark shows as an empty box, your terminal font is not a Nerd Font: use /dash-icons emoji.' : ''}` }
  })

  on('command.run', { command: 'dash-handoff' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    ctx.handoffOn = arg === 'on' ? true : arg === 'off' ? false : !ctx.handoffOn
    await $.store.set('handoffOn', ctx.handoffOn)

    return {
      text: ctx.handoffOn
        ? `Handoff notes on: one short note in ${ctx.handoffDir || '~/.claude/dev-dash/handoffs'} each time a session compacts (newest ${HANDOFFS_KEPT} kept).`
        : 'Handoff notes off. Notes already written stay where they are.',
    }
  })

  // A handoff note whenever the main conversation compacts, for whoever picks the work up after.
  // `precompute` installs nothing and a subagent's own compaction is not this session's, so both are skipped.
  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    if (!ctx.handoffOn || e.agentId || e.trigger === 'precompute' || ran.skip !== undefined || !ctx.handoffDir || !ctx.selfId) return ran
    const at = Date.now()
    try {
      await $.fs.write(
        `${ctx.handoffDir}/${handoffName(at, ctx.selfId)}`,
        handoffNote({
          at,
          sessionId: ctx.selfId,
          name: me.name,
          repo: me.repo,
          branch: me.branch,
          cwd: me.cwd,
          trigger: e.trigger,
          tokensBefore: ran.tokensBefore,
          tokensAfter: ran.tokensAfter,
          plan: ctx.plan,
          lastTool: me.lastTool,
          files: me.editing,
          summary: ran.messages[0]?.text ?? '',
        }),
      )
      note($, { at, tone: 'info', text: 'saved a handoff note for this compaction' }, false)
      await pruneHandoffs($)
    } catch {}

    return ran
  })

  on('command.run', { command: 'dash' }, async $ => {
    ctx.isOpen = true
    await update($, paneOpen, () => true)
    // focus: the keys work as soon as the pane is up, with no ctrl+x tab first.
    await $.ui.open({ id: PANE, title: 'Dev dashboard', focus: true })
    if (ctx.disks.length === 0) void readDisks($)
    void tick($, true)

    return { text: 'Dashboard opened.' }
  })

  on('command.run', { command: 'dash-hide' }, async $ => {
    await closePane($)

    return { text: 'Dashboard hidden.' }
  })

  // The drawing lives in ./render.tsx (drop-in replacement for the old inline hook).
  registerDashPane(on, {
    onHide: () => {
      ctx.isOpen = false
    },
  })
}
