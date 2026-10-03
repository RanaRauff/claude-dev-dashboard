export type SessionState = 'running' | 'idle' | 'waiting' | 'ended'

/** How far a session is through the todo list it keeps with TodoWrite. */
export type PlanProgress = { done: number; total: number; current: string }

/** A URL fetched or a query searched. */
export type SourceRow = { at: number; kind: 'fetch' | 'search'; label: string }

/** A file edited this turn, with lines added and removed versus HEAD. */
export type ChangedFile = {
  path: string
  added: number
  removed: number
  /** False when git could not count its lines (so added and removed are not real): shown without +/-. */
  counted?: boolean
}

export type SessionRow = {
  id: string
  name: string
  app: string
  hasPlugin: boolean
  waitingFor: string
  cwd: string
  repo: string
  branch: string
  state: SessionState
  stateSince: number
  startedAt: number
  lastTool: string
  costUsd: number | null
  contextPct: number | null
  updatedAt: number
  /** Why the session looks stuck ('' when it doesn't). Plugin sessions only. */
  stuck: string
  /** Files the session edited in the last 30 minutes, absolute and normalised. Plugin sessions only. */
  editing: string[]
  /** The risky shell command it ran in the last 10 minutes ('' when none). Plugin sessions only. */
  risky: string
  /** Context % at the end of each of its last 12 turns, oldest first. Plugin sessions only. */
  ctxTrend: number[]
  /** Share of input tokens read from the prompt cache on its last turn, 0-100. Plugin sessions only. */
  cacheHitPct: number | null
  /** One line on what the session is doing, written after each turn when summaries are on ('' otherwise). Plugin sessions only. */
  summary: string
  /** Its TodoWrite list progress; null when it has none. Plugin sessions only. */
  plan?: PlanProgress | null
  /** When the plan last changed. */
  planAt?: number
  /** URLs fetched and queries searched, newest first. Plugin sessions only. */
  sources?: SourceRow[]
  /** Files edited this turn (and not yet committed), with +/- lines. Plugin sessions only. */
  turnFiles?: ChangedFile[]
}

export type DiskRow = { name: string; freeBytes: number; totalBytes: number }

export type AgentState = 'working' | 'quiet' | 'done' | 'stopped'

export type AgentRow = {
  id: string
  sessionId: string
  sessionName: string
  type: string
  description: string
  state: AgentState
  isBackground: boolean
  startedAt: number
  lastActive: number
  /** The latest step, e.g. "WebSearch: claude code dashboards". */
  doing: string
  steps: number
}

export type LimitRow = {
  kind: string
  pct: number
  resetsAt: number | null
  /** Time until 100% at the recent pace; null when flat or unknown. */
  etaMs: number | null
}

export type EventTone = 'ok' | 'warn' | 'bad' | 'info'

export type EventRow = { at: number; tone: EventTone; text: string }

export type BranchRow = { name: string; age: string; isMerged: boolean }
export type WorktreeRow = { path: string; branch: string }

export type GitInfo = {
  branch: string
  upstream: boolean
  ahead: number
  behind: number
  dirty: number
  stashes: number
  base: string
  branches: BranchRow[]
  worktrees: WorktreeRow[]
  /** Lines added and removed in the working tree versus HEAD: not committed yet. */
  added: number
  removed: number
}

export type CiState = 'passing' | 'failing' | 'pending' | 'none'

export type PrRow = {
  number: number
  title: string
  /** Repository name without the owner. */
  repo: string
  url: string
  author: string
  ageDays: number
  review: string
  ci: CiState
  conflicts: boolean
}

export type PrInfo = { error: string | null; mine: PrRow[]; toReview: PrRow[]; fetchedAt: number }

/** A pull request the person asked to keep an eye on with /dash-watch. */
export type WatchKind = 'pr' | 'issue' | 'run' | 'mail'

/** How the icons for GitHub, Gmail and the like are drawn: the official marks from a Nerd Font, emoji, or letters. */
export type IconStyle = 'nerd' | 'emoji' | 'ascii'

export type WatchTone = 'ok' | 'warn' | 'bad' | 'info' | 'mute'

/** One small status mark in a watch's box: an icon, a word or two, and how it should be coloured. */
export type WatchChip = {
  icon: string
  text: string
  tone: WatchTone
  /** A time shown as how long ago it was (the last mail, say) instead of, or after, the text. */
  at?: number
}

export type WatchRow = {
  /** `pr:<owner/repo>#<number>`, `issue:…`, `run:…`, lower case; `mail:<subject>` for a mail thread. */
  id: string
  kind: WatchKind
  /** `owner/repo` for the GitHub kinds, '' for mail. */
  repo: string
  /** The pull request or issue number, or the Actions run id; 0 for mail. */
  number: number
  /** Mail: the subject words being watched. */
  query?: string
  /** The title of the PR, issue or run, as last read. */
  title: string
  /** The status marks as last read. */
  chips?: WatchChip[]
  /** The box's overall colour as last read. */
  tone?: WatchTone
  /** Why it cannot be read right now (no `gh`, mail connector not connected); cleared by the next good look. */
  problem?: string
  addedAt: number
  /** When it stops being polled and drops off the list: 24 hours after it was added, or after it last fired. */
  expiresAt: number
  /** The comparable state from the last look (`OPEN|passing|approved`); '' until the first look. */
  value: string
  /** The same, in words. */
  detail: string
  checkedAt: number
  changedAt: number
  /** When it last changed after the baseline look; 0 if it has not. */
  firedAt: number
  /** What changed, in words (`CI failing`, `merged`). */
  fired: string
  /** True once the PR is merged or closed: nothing left to poll. */
  done: boolean
}

export type Snapshot = {
  selfId: string
  sessions: SessionRow[]
  agents: AgentRow[]
  limits: LimitRow[]
  events: EventRow[]
  alertsOn: boolean
  /** Whether the one-line band above the prompt is on. */
  bandOn: boolean
  /** Whether this session writes a one-line summary after each turn (costs a small model call per turn). */
  summariesOn: boolean
  /** Whether this session's dashboard pane is open (the band steps aside). */
  paneOpen: boolean
  disks: DiskRow[]
  git: GitInfo | null
  prs: PrInfo | null
  /** What /dash-watch is keeping an eye on; the Watching section is hidden when empty. */
  watches?: WatchRow[]
  /** Which icon set the Watching boxes use; `/dash-icons` changes it. */
  iconStyle?: IconStyle
  updatedAt: number
}

export type DashSection = 'attention' | 'sessions' | 'agents' | 'monitor' | 'work' | 'prs' | 'plan' | 'sources' | 'files' | 'watching'

declare module 'claude-code' {
  interface PluginState {
    'dev-dash': {
      snap: Snapshot | null
      collapsed: DashSection[]
      activity: number[]
      /** Whether the pane is open; kept by the host so a reload of the mod doesn't forget it. */
      paneOpen: boolean
    }
  }
}
