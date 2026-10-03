import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { BranchRow, CiState, GitInfo, PrInfo, PrRow, SessionRow, SessionState, Snapshot, WorktreeRow } from '../types'

const PANE = 'dev-dash'
const TICK_MS = 5000
const PR_EVERY_TICKS = 12
const STALE_MS = 90_000
const snap = atom({ plugin: 'dev-dash', key: 'snap' } as const, null)

const lines = (s: string) => s.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
const pad = (n: number) => String(n).padStart(2, '0')

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}`
  return `${Math.floor(s / 86400)}d`
}

type Check = { conclusion?: string; status?: string; state?: string }

const FAILED = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']
const PENDING = ['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'WAITING']

const ciOf = (rollup: Check[] | undefined): CiState => {
  if (!rollup || rollup.length === 0) return 'none'
  const marks = rollup.map(c => (c.conclusion || c.state || c.status || '').toUpperCase())
  if (marks.some(m => FAILED.includes(m))) return 'failing'
  if (marks.some(m => PENDING.includes(m))) return 'pending'
  return 'passing'
}

type GhPr = {
  number: number
  title: string
  author?: { login?: string }
  createdAt: string
  reviewDecision?: string
  statusCheckRollup?: Check[]
  mergeable?: string
}

const toRow = (p: GhPr): PrRow => ({
  number: p.number,
  title: p.title,
  author: p.author?.login ?? '',
  ageDays: Math.floor((Date.now() - Date.parse(p.createdAt)) / 86_400_000),
  review: (p.reviewDecision || 'NONE').replace('_', ' ').toLowerCase(),
  ci: ciOf(p.statusCheckRollup),
  conflicts: p.mergeable === 'CONFLICTING',
})

const ctx = {
  selfId: '',
  dir: '',
  registryDir: '',
  isOpen: false,
  ticks: 0,
  prs: null as PrInfo | null,
}
const me = {
  id: '',
  name: '',
  app: '',
  hasPlugin: true,
  cwd: '',
  repo: '',
  branch: '',
  state: 'idle' as SessionState,
  stateSince: Date.now(),
  startedAt: Date.now(),
  lastTool: '',
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
  try {
    const u = await $.session.usage()
    costUsd = u.cost?.usd ?? null
    contextPct = u.context.percent ?? null
  } catch {}
  const row: SessionRow = { ...me, costUsd, contextPct, updatedAt: Date.now() }
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
    rows.push({
      id: reg.sessionId,
      name: reg.name ?? '',
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
    })
  }
  for (const beat of beats.values()) {
    if (!seen.has(beat.id)) rows.push(beat)
  }
  const order: Record<SessionState, number> = { waiting: 0, running: 1, idle: 2, ended: 3 }

  return rows.sort((a, b) => order[a.state] - order[b.state] || b.startedAt - a.startedAt)
}

async function readGit($: Engine): Promise<GitInfo | null> {
  const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim()
  if (!branch) return null
  const [status, counts, stash, head, refs, wt] = await Promise.all([
    git($, ['status', '--porcelain']),
    git($, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
    git($, ['stash', 'list']),
    git($, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
    git($, ['for-each-ref', '--sort=-committerdate', '--count=8', '--format=%(refname:short)|%(committerdate:relative)', 'refs/heads']),
    git($, ['worktree', 'list', '--porcelain']),
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
  }
}

async function readPrs($: Engine): Promise<PrInfo> {
  const fields = 'number,title,author,createdAt,reviewDecision,statusCheckRollup,mergeable'
  const gh = async (extra: string[]) => {
    const r = await $.process.run(['gh', 'pr', 'list', '--state', 'open', '--limit', '20', '--json', fields, ...extra], {
      timeoutMs: 20_000,
    })
    if (r.exitCode !== 0) throw new Error(lines(r.stderr)[0] ?? 'gh failed')
    return JSON.parse(r.stdout) as GhPr[]
  }
  try {
    const [mine, toReview] = await Promise.all([gh(['--author', '@me']), gh(['--search', 'review-requested:@me'])])
    return {
      error: null,
      mine: mine.map(toRow),
      toReview: toReview.map(toRow).sort((a, b) => b.ageDays - a.ageDays),
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

async function publish($: Engine, gitInfo: GitInfo | null | undefined) {
  const sessions = await readSessions($)
  await update($, snap, s => {
    const next: Snapshot = {
      selfId: ctx.selfId,
      sessions,
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
  await publish($, g)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    ctx.selfId = await $.session.id()
    const home = ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/')
    const config = ((await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`).replace(/\\/g, '/')
    ctx.dir = `${config}/dev-dash/sessions`
    ctx.registryDir = `${config}/sessions`
    me.id = ctx.selfId
    me.cwd = await $.session.cwd()
    const top = (await git($, ['rev-parse', '--show-toplevel']))?.trim()
    me.repo = base(top || me.cwd)
    try {
      me.startedAt = (await $.session.usage()).startedAt
    } catch {}

    await $.command.register({ name: 'dash', description: 'Open the developer dashboard pane' })
    await $.command.register({ name: 'dash-hide', description: 'Hide the developer dashboard pane' })
    await tick($, false)
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
    await setState($, 'idle')

    return ran
  })

  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (r.decision === 'ask') await setState($, 'waiting')

    return r
  })

  on('tool.call', async ($, e, next) => {
    me.lastTool = e.tool
    if (e.tool === 'AskUserQuestion') {
      await setState($, 'waiting')
      const r = await next(e)
      await setState($, 'running')
      return r
    }
    await setState($, 'running')

    return next(e)
  })

  on('command.run', { command: 'dash' }, async $ => {
    ctx.isOpen = true
    await $.ui.open({ id: PANE, title: 'Dev dashboard' })
    void tick($, true)

    return { text: 'Dashboard opened.' }
  })

  on('command.run', { command: 'dash-hide' }, async $ => {
    ctx.isOpen = false
    await $.ui.close({ id: PANE })

    return { text: 'Dashboard hidden.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, snap)
    const now = Date.now()
    const width = Math.max(30, (e.viewport?.columns ?? 60) - 2)

    if (!s) {
      return <Text dimColor>Collecting…</Text>
    }

    const waiting = s.sessions.filter(r => r.state === 'waiting')
    const failing = (s.prs?.mine ?? []).filter(p => p.ci === 'failing' || p.conflicts)
    const reviews = s.prs?.toReview ?? []
    const needsYou = waiting.length + failing.length + reviews.length
    const stateColor = { running: 'green', idle: 'gray', waiting: 'yellow', ended: 'gray' } as const
    const ciColor = { passing: 'green', failing: 'red', pending: 'yellow', none: 'gray' } as const
    const g = s.git
    const sessionByCwd = new Map(s.sessions.map(r => [norm(r.cwd), r] as const))

    return (
      <Box flexDirection="column">
        <Text bold color={needsYou > 0 ? 'yellow' : 'green'}>
          ▍Attention {needsYou > 0 ? `(${needsYou})` : '- all clear'}
        </Text>
        {waiting.map(r => (
          <Text color="yellow">
            {'  '}⏸ {cut(`${r.repo}@${r.branch}`, width - 22)} waiting {ago(now - r.stateSince)}
          </Text>
        ))}
        {failing.map(p => (
          <Text color="red">
            {'  '}✗ #{p.number} {p.conflicts ? 'conflicts' : 'CI failing'} · {cut(p.title, width - 26)}
          </Text>
        ))}
        {reviews.slice(0, 5).map(p => (
          <Text color="cyan">
            {'  '}◎ review #{p.number} @{p.author} {p.ageDays}d · {cut(p.title, width - 32)}
          </Text>
        ))}
        <Text> </Text>

        <Text bold>▍Sessions ({s.sessions.length})</Text>
        {s.sessions.length === 0 && <Text dimColor>{'  '}none</Text>}
        {s.sessions.map(r => (
          <Box flexDirection="column">
            <Text color={stateColor[r.state]}>
              {'  '}
              {r.state === 'running' ? '●' : r.state === 'waiting' ? '⏸' : '○'}{' '}
              {cut(r.branch ? `${r.repo}@${r.branch}` : r.repo, width - 24)}
              {r.id === s.selfId ? ' (this)' : ''} · {r.state} {ago(now - r.stateSince)}
            </Text>
            <Text dimColor>
              {'    '}
              {[
                r.name,
                r.app,
                `up ${ago(now - r.startedAt)}`,
                r.costUsd !== null ? `$${r.costUsd.toFixed(2)}` : '',
                r.contextPct !== null ? `ctx ${Math.round(r.contextPct)}%` : '',
                r.lastTool,
                r.hasPlugin ? '' : 'no plugin: cost/ctx n/a',
              ]
                .filter(Boolean)
                .join(' · ')}
              {r.contextPct !== null && r.contextPct >= 80 ? ' ⚠ near compaction' : ''}
            </Text>
          </Box>
        ))}
        <Text> </Text>

        <Text bold>▍Work in flight</Text>
        {!g && <Text dimColor>{'  '}not a git repository</Text>}
        {g && (
          <Box flexDirection="column">
            <Text>
              {'  '}
              {g.branch}
              {g.upstream ? ` ↑${g.ahead} ↓${g.behind}` : ' (no upstream)'} · {g.dirty} uncommitted
              {g.stashes > 0 ? ` · ${g.stashes} stashed` : ''}
            </Text>
            {g.branches
              .filter(b => b.name !== g.branch)
              .slice(0, 6)
              .map(b => (
                <Text dimColor={!b.isMerged} color={b.isMerged ? 'magenta' : undefined}>
                  {'    '}
                  {cut(b.name, width - 28)} · {b.age}
                  {b.isMerged ? ` · merged into ${g.base}` : ''}
                </Text>
              ))}
            {g.worktrees.length > 1 && <Text dimColor>{'  '}worktrees:</Text>}
            {g.worktrees.length > 1 &&
              g.worktrees.map(w => {
                const used = sessionByCwd.get(norm(w.path))
                const who = used ? (used.id === s.selfId ? 'this session' : `session ${used.id.slice(0, 8)}`) : ''
                return (
                  <Text dimColor>
                    {'    '}
                    {cut(base(w.path), 20)} [{w.branch}]{who ? ` ← ${who}` : ''}
                  </Text>
                )
              })}
          </Box>
        )}
        <Text> </Text>

        <Text bold>▍PRs & CI</Text>
        {!s.prs && <Text dimColor>{'  '}loading…</Text>}
        {s.prs?.error && <Text color="yellow">{'  '}{s.prs.error}</Text>}
        {s.prs && !s.prs.error && (
          <Box flexDirection="column">
            <Text dimColor>{'  '}mine ({s.prs.mine.length})</Text>
            {s.prs.mine.map(p => (
              <Text>
                {'    '}#{p.number} <Text color={ciColor[p.ci]}>{p.ci}</Text> · {p.review} · {p.ageDays}d
                {p.conflicts ? ' · conflicts' : ''} · {cut(p.title, width - 42)}
              </Text>
            ))}
            <Text dimColor>{'  '}to review ({s.prs.toReview.length})</Text>
            {s.prs.toReview.map(p => (
              <Text>
                {'    '}#{p.number} @{p.author} · {p.ageDays}d · {cut(p.title, width - 32)}
              </Text>
            ))}
            <Text dimColor>{'  '}updated {ago(now - s.prs.fetchedAt)} ago</Text>
          </Box>
        )}
        <Text> </Text>
        <Button
          key="hide"
          label="Hide dashboard"
          onPress={async () => {
            ctx.isOpen = false
            await $.ui.close({ id: PANE })
          }}
        />
      </Box>
    )
  })
}
