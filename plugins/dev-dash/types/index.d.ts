export type SessionState = 'running' | 'idle' | 'waiting' | 'ended'

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
}

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

export type Snapshot = {
  selfId: string
  sessions: SessionRow[]
  agents: AgentRow[]
  limits: LimitRow[]
  events: EventRow[]
  alertsOn: boolean
  git: GitInfo | null
  prs: PrInfo | null
  updatedAt: number
}

export type DashSection = 'attention' | 'sessions' | 'agents' | 'monitor' | 'work' | 'prs'

declare module 'claude-code' {
  interface PluginState {
    'dev-dash': {
      snap: Snapshot | null
      collapsed: DashSection[]
      activity: number[]
    }
  }
}
