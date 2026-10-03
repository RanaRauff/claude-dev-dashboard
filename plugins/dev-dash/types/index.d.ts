export type SessionState = 'running' | 'idle' | 'waiting' | 'ended'

export type SessionRow = {
  id: string
  name: string
  app: string
  hasPlugin: boolean
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
}

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
}

export type CiState = 'passing' | 'failing' | 'pending' | 'none'

export type PrRow = {
  number: number
  title: string
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
  git: GitInfo | null
  prs: PrInfo | null
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'dev-dash': { snap: Snapshot | null }
  }
}
