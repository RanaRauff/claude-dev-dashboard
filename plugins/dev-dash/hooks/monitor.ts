// dev-dash: pure monitoring logic. Nothing here touches `$`, so every function
// can be tested on plain values.

import type { AgentRow, CiState, EventRow, PrRow, SessionRow, SessionState } from '../types'

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
const oneLine = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// ---------------------------------------------------------------------------
// What a tool call is doing, in a few words
// ---------------------------------------------------------------------------
export const toolDetail = (tool: string, input: Record<string, unknown> | undefined): string => {
  const s = (k: string) => (typeof input?.[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return oneLine(s('description') || s('command'), 50)
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return baseName(s('file_path') || s('notebook_path'))
    case 'Grep':
    case 'Glob':
      return oneLine(s('pattern'), 40)
    case 'WebSearch':
      return oneLine(s('query'), 50)
    case 'WebFetch': {
      const url = s('url')
      return oneLine(url.replace(/^https?:\/\//, ''), 50)
    }
    case 'Agent':
    case 'Task':
      return oneLine(s('description'), 50)
    case 'SendMessage':
      return s('to')
    default:
      return ''
  }
}

export const stepLabel = (tool: string, input?: Record<string, unknown>) => {
  const detail = toolDetail(tool, input)
  return detail ? `${tool}: ${detail}` : tool
}

// ---------------------------------------------------------------------------
// Subagent transcripts (<projects>/<slug>/<session>/subagents/agent-<id>.jsonl)
// ---------------------------------------------------------------------------
export type AgentSummary = {
  startedAt: number | null
  steps: number
  doing: string
  isFinished: boolean
}

type Block = { type?: string; name?: string; input?: Record<string, unknown> }
type Line = { type?: string; timestamp?: string; message?: { content?: unknown; stop_reason?: string } }

/** Reads an agent transcript: when it started, how many tool steps, its latest step, and whether it handed back. */
export const summarizeAgent = (text: string): AgentSummary => {
  let startedAt: number | null = null
  let steps = 0
  let doing = ''
  let isFinished = false
  for (const raw of text.split(/\r?\n/)) {
    if (!raw) continue
    let d: Line
    try {
      d = JSON.parse(raw) as Line
    } catch {
      continue
    }
    if (startedAt === null && d.timestamp) {
      const t = Date.parse(d.timestamp)
      if (Number.isFinite(t)) startedAt = t
    }
    if (d.type !== 'assistant') {
      if (d.type === 'user') isFinished = false
      continue
    }
    const blocks = Array.isArray(d.message?.content) ? (d.message?.content as Block[]) : []
    const uses = blocks.filter(b => b?.type === 'tool_use')
    if (uses.length === 0) {
      // A reply with no tool call ends the agent's turn.
      if (blocks.some(b => b?.type === 'text')) isFinished = true
      continue
    }
    steps += uses.length
    const last = uses[uses.length - 1]
    const tool = last.name ?? 'tool'
    isFinished = tool === 'SubagentHandback'
    doing = isFinished ? 'handed back its report' : stepLabel(tool, last.input)
  }

  return { startedAt, steps, doing, isFinished }
}

export type AgentMeta = {
  agentType?: string
  description?: string
  requestShape?: string
  stoppedByUser?: boolean
}

/** How long without a transcript write before a still-open agent counts as quiet rather than working. */
export const QUIET_AFTER_MS = 90_000

export const agentStateOf = (meta: AgentMeta, sum: AgentSummary, lastActive: number, now: number, isSessionAlive: boolean) => {
  if (meta.stoppedByUser) return 'stopped' as const
  if (sum.isFinished) return 'done' as const
  if (!isSessionAlive) return 'stopped' as const
  return now - lastActive < QUIET_AFTER_MS ? ('working' as const) : ('quiet' as const)
}

// ---------------------------------------------------------------------------
// Usage-limit runway
// ---------------------------------------------------------------------------
export type Sample = { at: number; pct: number }

/** Time until 100% at the pace seen across `samples` (oldest first); null when flat, falling, or too little history. */
export const runwayMs = (samples: readonly Sample[]): number | null => {
  if (samples.length < 2) return null
  const first = samples[0]
  const last = samples[samples.length - 1]
  const dt = last.at - first.at
  const dp = last.pct - first.pct
  if (dt < 120_000 || dp <= 0) return null
  return Math.max(0, ((100 - last.pct) / dp) * dt)
}

export const limitLabel = (kind: string) =>
  ({ five_hour: '5h', seven_day: '7d', seven_day_opus: '7d opus', seven_day_sonnet: '7d sonnet', spend_limit: 'spend' })[kind] ??
  kind.replace(/_/g, ' ')

// ---------------------------------------------------------------------------
// Stuck detection for this session's own tool calls
// ---------------------------------------------------------------------------
export type CallMark = { key: string; label: string; isOk: boolean; at: number }

export const callKey = (tool: string, input: Record<string, unknown> | undefined) => {
  const main = input?.command ?? input?.file_path ?? input?.pattern ?? input?.url ?? input?.query ?? ''
  return `${tool}|${typeof main === 'string' ? main : JSON.stringify(main)}`
}

/** '' when fine; otherwise why it looks stuck. `calls` is newest last. */
export const stuckReason = (calls: readonly CallMark[]): string => {
  const recent = calls.slice(-6)
  const last = recent[recent.length - 1]
  if (!last) return ''
  const tail3 = recent.slice(-3)
  if (tail3.length === 3 && tail3.every(c => c.key === last.key && !c.isOk)) {
    return `${last.label} failed ${tail3.length}× in a row`
  }
  if (recent.length === 6 && recent.every(c => c.key === last.key)) return `repeating ${last.label}`
  return ''
}

// ---------------------------------------------------------------------------
// Two sessions editing the same file
// ---------------------------------------------------------------------------
export type Collision = { file: string; sessions: string[] }

export const collisionsOf = (sessions: readonly SessionRow[]): Collision[] => {
  const byFile = new Map<string, string[]>()
  for (const r of sessions) {
    for (const f of r.editing ?? []) byFile.set(f, [...(byFile.get(f) ?? []), r.name || r.repo])
  }

  return [...byFile.entries()].filter(([, who]) => who.length > 1).map(([file, who]) => ({ file, sessions: who }))
}

// ---------------------------------------------------------------------------
// git diff --shortstat
// ---------------------------------------------------------------------------
export const parseShortstat = (s: string) => ({
  added: Number(/(\d+) insertion/.exec(s)?.[1] ?? 0),
  removed: Number(/(\d+) deletion/.exec(s)?.[1] ?? 0),
})

// ---------------------------------------------------------------------------
// Events: what changed between two snapshots
// ---------------------------------------------------------------------------
export type Seen = {
  sessions: Map<string, { state: SessionState; since: number; stuck: string; risky: string }>
  agents: Map<string, AgentRow['state']>
  ci: Map<number, CiState>
}

export const emptySeen = (): Seen => ({ sessions: new Map(), agents: new Map(), ci: new Map() })

export type Change = EventRow & { isAlert: boolean }

/**
 * Compares the last view with the new one. `isAlert` marks what is worth a toast:
 * something now needs the person. The first call (empty `seen`) reports nothing.
 */
export const changesBetween = (
  seen: Seen,
  sessions: readonly SessionRow[],
  agents: readonly AgentRow[],
  mine: readonly PrRow[] | null,
  selfId: string,
  now: number,
  isFirst: boolean,
): Change[] => {
  const out: Change[] = []
  const name = (r: SessionRow) => r.name || `${r.repo}${r.branch ? `@${r.branch}` : ''}`

  for (const r of sessions) {
    const was = seen.sessions.get(r.id)
    if (!isFirst && was) {
      if (r.state === 'waiting' && was.state !== 'waiting' && r.id !== selfId) {
        out.push({ at: now, tone: 'warn', text: `${name(r)} needs ${r.waitingFor || 'you'}`, isAlert: true })
      }
      if (r.state === 'idle' && was.state === 'running' && now - was.since > 60_000 && r.id !== selfId) {
        const isLong = now - was.since >= LONG_TASK_MS
        out.push({ at: now, tone: 'ok', text: `${name(r)} finished${isLong ? ` after ${Math.round((now - was.since) / 60_000)}m` : ''}`, isAlert: isLong })
      }
      if (r.risky && r.risky !== was.risky) {
        out.push({ at: now, tone: 'bad', text: `${name(r)} ran a risky command: ${r.risky}`, isAlert: true })
      }
      if (r.stuck && r.stuck !== was.stuck) {
        out.push({ at: now, tone: 'bad', text: `${name(r)} may be stuck: ${r.stuck}`, isAlert: true })
      }
    }
    if (!isFirst && !was && r.id !== selfId) out.push({ at: now, tone: 'info', text: `${name(r)} started`, isAlert: false })
  }

  for (const a of agents) {
    const was = seen.agents.get(a.id)
    if (isFirst) continue
    if (!was && (a.state === 'working' || a.state === 'quiet')) {
      out.push({ at: now, tone: 'info', text: `agent started: ${a.description}`, isAlert: false })
    } else if (was && was !== a.state && a.state === 'done') {
      out.push({ at: now, tone: 'ok', text: `agent finished: ${a.description}`, isAlert: true })
    } else if (was && was !== a.state && a.state === 'stopped') {
      out.push({ at: now, tone: 'warn', text: `agent stopped: ${a.description}`, isAlert: false })
    }
  }

  for (const p of mine ?? []) {
    const was = seen.ci.get(p.number)
    if (isFirst || was === undefined || was === p.ci) continue
    if (p.ci === 'failing') out.push({ at: now, tone: 'bad', text: `#${p.number} CI went red`, isAlert: true })
    else if (p.ci === 'passing' && was === 'failing') out.push({ at: now, tone: 'ok', text: `#${p.number} CI is green again`, isAlert: true })
  }

  return out
}

export const remember = (sessions: readonly SessionRow[], agents: readonly AgentRow[], mine: readonly PrRow[] | null): Seen => ({
  sessions: new Map(sessions.map(r => [r.id, { state: r.state, since: r.stateSince, stuck: r.stuck, risky: r.risky }] as const)),
  agents: new Map(agents.map(a => [a.id, a.state] as const)),
  ci: new Map((mine ?? []).map(p => [p.number, p.ci] as const)),
})

/** Context thresholds crossed upward since `last` (e.g. 48 → 77 crosses 50 and 75). */
export const CONTEXT_STEPS = [50, 75, 90] as const
export const crossedSteps = (last: number | null, now: number | null) =>
  last === null || now === null ? [] : CONTEXT_STEPS.filter(step => last < step && now >= step)

// ---------------------------------------------------------------------------
// Risky shell commands (flagged, never blocked)
// ---------------------------------------------------------------------------
const RISKY: ReadonlyArray<[RegExp, string]> = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\b/i, 'rm -rf'],
  [/\bgit\s+push\b[^\n;&|]*\s(--force(?!-with-lease)|-f\b)/i, 'git push --force'],
  [/\bgit\s+reset\s+--hard\b/i, 'git reset --hard'],
  [/\bgit\s+clean\s+-[a-z]*f/i, 'git clean -f'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/i, 'discard all changes'],
  [/\bgit\s+branch\s+-D\b/, 'git branch -D'],
  [/\bdrop\s+(database|table|schema)\b/i, 'DROP'],
  [/\btruncate\s+table\b/i, 'TRUNCATE'],
  [/\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force|\bRemove-Item\b[^\n]*-Force[^\n]*-Recurse/i, 'Remove-Item -Recurse -Force'],
  [/\b(del|erase)\s+(\/[a-z]\s+)*\/s\b/i, 'del /s'],
  [/\brd\s+\/s\b|\brmdir\s+\/s\b/i, 'rmdir /s'],
  [/\bmkfs(\.\w+)?\b|\bformat\s+[a-z]:/i, 'format disk'],
  [/\bdd\s+if=.*\bof=\/dev\//i, 'dd to a device'],
  [/\bchmod\s+-R\s+777\b/i, 'chmod -R 777'],
  [/\b(kubectl|terraform)\s+(delete|destroy)\b/i, 'infra delete'],
]

/** The risky pattern a shell command matches, or ''. */
export const riskyReason = (command: string): string => RISKY.find(([re]) => re.test(command))?.[1] ?? ''

// ---------------------------------------------------------------------------
// Prompt cache
// ---------------------------------------------------------------------------
export type TokenUsage = {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** Share of input tokens served from cache, 0-100, or null with no input. */
export const cacheHitPct = (u: TokenUsage | undefined | null): number | null => {
  if (!u) return null
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return total > 0 ? Math.round((u.cache_read_input_tokens / total) * 100) : null
}

// ---------------------------------------------------------------------------
// Disk space
// ---------------------------------------------------------------------------
export type Disk = { name: string; freeBytes: number; totalBytes: number }

/** PowerShell `Get-PSDrive` lines: "<Name> <Free> <Used>". */
export const parseWindowsDisks = (out: string): Disk[] =>
  out
    .split(/\r?\n/)
    .map(l => l.trim().split(/\s+/))
    .filter(p => p.length === 3 && /^\d+$/.test(p[1]) && /^\d+$/.test(p[2]))
    .map(([name, free, used]) => ({ name: `${name}:`, freeBytes: Number(free), totalBytes: Number(free) + Number(used) }))
    .filter(d => d.totalBytes > 0)

/** `df -Pk` output: real filesystems only, by mount point. */
export const parseDf = (out: string): Disk[] =>
  out
    .split(/\r?\n/)
    .slice(1)
    .map(l => l.trim().split(/\s+/))
    .filter(p => p.length >= 6 && p[0].startsWith('/dev/') && /^\d+$/.test(p[1]))
    .map(p => ({ name: p.slice(5).join(' '), freeBytes: Number(p[3]) * 1024, totalBytes: Number(p[1]) * 1024 }))

export const LOW_DISK_PCT = 10
export const LOW_DISK_BYTES = 5 * 1024 ** 3
export const isDiskLow = (d: Disk) => d.freeBytes < LOW_DISK_BYTES || (d.freeBytes / d.totalBytes) * 100 < LOW_DISK_PCT

export const bytes = (n: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** A task counts as long, worth a ping when it ends, after this long running. */
export const LONG_TASK_MS = 5 * 60_000
