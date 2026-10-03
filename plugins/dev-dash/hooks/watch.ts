// dev-dash: /dash-watch. Keep an eye on a GitHub pull request, issue or Actions run and say when it changes.
// Pure functions only, so they test without a session; register.tsx polls `gh` and stores the list,
// watch-view.tsx draws it.
//
// A watch is something the person typed. It is polled with `gh` only while the pane is open (and once when
// it is added, to take a baseline), no faster than every 60 seconds, and never toasts.

import type { CiState, WatchChip, WatchKind, WatchRow, WatchTone } from '../types'

export const WATCHES_KEPT = 10
export const WATCH_EXPIRY_MS = 24 * 3_600_000
export const WATCH_EVERY_MS = 60_000

export type PrRef = { repo: string; number: number }

/** What one look found: a comparable `value`, words for the person, the marks to draw, and whether it is over. */
export type Reading = { value: string; detail: string; title: string; done: boolean; chips: WatchChip[]; tone: WatchTone }

const chip = (icon: string, text: string, tone: WatchTone): WatchChip => ({ icon, text, tone })

/** What is being watched: a pull request, an issue or an Actions run. `repo` is '' until the caller fills it in. */
export type WatchSpec = { kind: WatchKind; repo: string; number: number }

/** `42`, `#42`, `owner/repo#42` or a GitHub URL with `path` (`pull`, `issues`, `actions/runs`) in it. `repo` is '' for a bare number. */
function parseRef(input: string, path: string): PrRef | null {
  const s = input.trim()
  const url = new RegExp(`^https?:\\/\\/github\\.com\\/([^/\\s]+\\/[^/\\s]+)\\/${path}\\/(\\d+)`, 'i').exec(s)
  if (url) return { repo: url[1], number: Number(url[2]) }
  const short = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(s)
  if (short) return { repo: short[1], number: Number(short[2]) }
  const bare = /^#?(\d+)$/.exec(s)

  return bare ? { repo: '', number: Number(bare[1]) } : null
}

export const parsePrRef = (input: string) => parseRef(input, 'pull')
export const parseIssueRef = (input: string) => parseRef(input, 'issues')
export const parseRunRef = (input: string) => parseRef(input, 'actions\\/runs')

const FAILED = ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']

/** `statusCheckRollup` of `gh pr view --json`: one entry per check run or status. */
export function checksOf(rollup: unknown): CiState {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none'
  let isPending = false
  for (const c of rollup) {
    const r = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
    const conclusion = String(r.conclusion ?? '').toUpperCase()
    const status = String(r.status ?? '').toUpperCase()
    const state = String(r.state ?? '').toUpperCase()
    if (FAILED.includes(conclusion) || state === 'FAILURE' || state === 'ERROR') return 'failing'
    if ((status && status !== 'COMPLETED') || state === 'PENDING' || state === 'EXPECTED') isPending = true
  }

  return isPending ? 'pending' : 'passing'
}

const reviewOf = (v: unknown) => String(v ?? '').toLowerCase().replace(/_/g, ' ') || 'none'

/** The fields `gh pr view --json` is asked for. */
export const PR_FIELDS = 'state,title,isDraft,mergeable,reviewDecision,statusCheckRollup'

/** `approved`, `changes requested`, or `not approved` for anything else (review required, no review yet). */
const reviewWords = (review: string) => (review === 'approved' || review === 'changes requested' ? review : 'not approved')

const CI_WORDS: Record<CiState, string> = { passing: 'CI passing', failing: 'CI failing', pending: 'CI running', none: 'no CI checks' }
const CI_CHIP: Record<CiState, WatchChip> = {
  passing: chip('●', 'CI', 'ok'),
  failing: chip('✗', 'CI', 'bad'),
  pending: chip('◐', 'CI', 'warn'),
  none: chip('·', 'no CI', 'mute'),
}

/** Where an open PR stands: still a draft, nothing in the way of merging it, or something is. */
export type Stage = 'draft' | 'ready' | 'open'
const STAGE_WORDS: Record<Stage, string> = { draft: 'draft', ready: 'ready to merge', open: 'open' }
const STAGE_CHIP: Record<Stage, WatchChip> = {
  draft: chip('✎', 'draft', 'mute'),
  ready: chip('✔', 'ready', 'ok'),
  open: chip('○', 'open', 'info'),
}

/**
 * One `gh pr view --json state,title,isDraft,mergeable,reviewDecision,statusCheckRollup` answer, or null if it is not one.
 * "Ready to merge" means open, not a draft, no merge conflicts, CI neither failing nor still running, and no
 * review outstanding or asking for changes. A PR that needs no review can be ready while "not approved".
 */
export function readPr(json: unknown): Reading | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const state = String(j.state ?? '').toUpperCase()
  if (state !== 'OPEN' && state !== 'MERGED' && state !== 'CLOSED') return null
  const ci = checksOf(j.statusCheckRollup)
  const review = reviewOf(j.reviewDecision)
  const hasConflicts = String(j.mergeable ?? '').toUpperCase() === 'CONFLICTING'
  const isBlocked = hasConflicts || ci === 'failing' || ci === 'pending' || review === 'changes requested' || review === 'review required'
  const stage: Stage = j.isDraft === true ? 'draft' : isBlocked ? 'open' : 'ready'
  const detail =
    state === 'OPEN' ? [STAGE_WORDS[stage], hasConflicts ? 'merge conflicts' : '', CI_WORDS[ci], reviewWords(review)].filter(Boolean).join(' · ') : state.toLowerCase()
  const value = `${state}|${ci}|${review}|${stage}|${hasConflicts ? 'conflict' : ''}`
  const title = String(j.title ?? '').trim()
  if (state !== 'OPEN') {
    const merged = state === 'MERGED'

    return { value, detail, title, done: true, chips: [chip(merged ? '⑂' : '✗', detail, merged ? 'info' : 'mute')], tone: merged ? 'info' : 'mute' }
  }
  const approval = review === 'approved' ? chip('✔', 'approved', 'ok') : review === 'changes requested' ? chip('±', 'changes', 'bad') : chip('○', 'no approval', 'mute')
  const chips = [STAGE_CHIP[stage], ...(hasConflicts ? [chip('⚠', 'conflicts', 'bad')] : []), CI_CHIP[ci], approval]
  const tone: WatchTone = ci === 'failing' || hasConflicts || review === 'changes requested' ? 'bad' : stage === 'ready' ? 'ok' : stage === 'draft' ? 'mute' : 'warn'

  return { value, detail, title, done: false, chips, tone }
}

/** What changed between two values, in words: `CI failing, approved, ready to merge`, `merged`. */
export function describeChange(prev: string, next: string): string {
  const [ps, pc, pr, pg, pk] = prev.split('|')
  const [ns, nc, nr, ng, nk] = next.split('|')
  if (ns !== ps && ns !== 'OPEN') return ns === 'MERGED' ? 'merged' : 'closed'
  const parts: string[] = []
  if (ns !== ps) parts.push('reopened')
  // A value saved before stages existed has no stage to compare.
  if (pg !== undefined && ng !== undefined && ng !== pg) {
    if (ng === 'draft') parts.push('back to draft')
    else if (pg === 'draft' && ng === 'open') parts.push('ready for review')
  }
  if (pk !== undefined && nk !== undefined && nk !== pk) parts.push(nk === 'conflict' ? 'merge conflicts' : 'conflicts resolved')
  if (nc !== pc) parts.push(`CI ${nc}`)
  if (nr !== pr) parts.push(reviewWords(nr))
  if (pg !== undefined && ng === 'ready' && pg !== 'ready') parts.push('ready to merge')

  return parts.join(', ') || 'changed'
}

// ---------------------------------------------------------------------------
// GitHub issues
// ---------------------------------------------------------------------------
export const ISSUE_FIELDS = 'state,title,stateReason,comments,labels,assignees'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const names = (v: unknown, key: string): string[] =>
  Array.isArray(v) ? v.map(x => String((x && typeof x === 'object' ? (x as Record<string, unknown>)[key] : x) ?? '').trim()).filter(Boolean) : []

/** One `gh issue view --json state,title,stateReason,comments,labels,assignees` answer, or null if it is not one. */
export function readIssue(json: unknown): Reading | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const state = String(j.state ?? '').toUpperCase()
  if (state !== 'OPEN' && state !== 'CLOSED') return null
  const comments = Array.isArray(j.comments) ? j.comments.length : 0
  const labels = names(j.labels, 'name').sort()
  const assignees = names(j.assignees, 'login')
  const isOpen = state === 'OPEN'
  const closedWord = String(j.stateReason ?? '').toUpperCase() === 'NOT_PLANNED' ? 'not planned' : 'closed'
  const detail = isOpen ? ['open', plural(comments, 'comment'), assignees.length ? `assigned to ${assignees.join(', ')}` : 'unassigned'].join(' · ') : closedWord

  const chips = isOpen
    ? [
        chip('○', 'open', 'ok'),
        chip('💬', String(comments), comments ? 'info' : 'mute'),
        chip('👤', assignees.length ? assignees[0] + (assignees.length > 1 ? ` +${assignees.length - 1}` : '') : 'unassigned', assignees.length ? 'info' : 'mute'),
        ...(labels.length ? [chip('🏷', labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` +${labels.length - 2}` : ''), 'mute')] : []),
      ]
    : [chip('✓', closedWord, 'mute'), chip('💬', String(comments), 'mute')]

  return { value: `${state}|${comments}|${labels.join(',')}|${assignees.join(',')}`, detail, title: String(j.title ?? '').trim(), done: !isOpen, chips, tone: isOpen ? 'info' : 'mute' }
}

/** What changed between two issue values, in words: `2 new comments`, `assigned`, `closed`. */
export function describeIssueChange(prev: string, next: string): string {
  const [ps, pc, pl, pa] = prev.split('|')
  const [ns, nc, nl, na] = next.split('|')
  if (ns !== ps) return ns === 'CLOSED' ? 'closed' : 'reopened'
  const parts: string[] = []
  const added = Number(nc) - Number(pc)
  if (added > 0) parts.push(added === 1 ? 'new comment' : `${added} new comments`)
  if (na !== pa) parts.push(na ? 'assigned' : 'unassigned')
  if (nl !== pl) parts.push('labels changed')

  return parts.join(', ') || 'changed'
}

// ---------------------------------------------------------------------------
// GitHub Actions runs
// ---------------------------------------------------------------------------
export const RUN_FIELDS = 'status,conclusion,name,workflowName,displayTitle,headBranch'

/** One `gh run view --json status,conclusion,...` answer, or null if it is not one. */
export function readRun(json: unknown): Reading | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const status = String(j.status ?? '').toLowerCase()
  if (!status) return null
  const conclusion = String(j.conclusion ?? '').toLowerCase()
  const isDone = status === 'completed'
  const title = [String(j.workflowName ?? j.name ?? '').trim(), String(j.headBranch ?? '').trim()].filter(Boolean).join(' · ') || String(j.displayTitle ?? '').trim()
  const detail = !isDone
    ? status === 'queued' || status === 'waiting' || status === 'pending'
      ? 'queued'
      : 'running'
    : conclusion === 'success'
      ? 'passed'
      : conclusion === 'cancelled'
        ? 'cancelled'
        : conclusion === 'skipped'
          ? 'skipped'
          : 'failed'

  const look: Record<string, { c: WatchChip; tone: WatchTone }> = {
    queued: { c: chip('◌', 'queued', 'mute'), tone: 'mute' },
    running: { c: chip('◐', 'running', 'warn'), tone: 'warn' },
    passed: { c: chip('✔', 'passed', 'ok'), tone: 'ok' },
    failed: { c: chip('✗', 'failed', 'bad'), tone: 'bad' },
    cancelled: { c: chip('■', 'cancelled', 'mute'), tone: 'mute' },
    skipped: { c: chip('·', 'skipped', 'mute'), tone: 'mute' },
  }

  return { value: `${status}|${conclusion}`, detail, title, done: isDone, chips: [look[detail].c], tone: look[detail].tone }
}

export function describeRunChange(_prev: string, next: string): string {
  return readRun({ status: next.split('|')[0], conclusion: next.split('|')[1] })?.detail ?? 'changed'
}

/** What changed between two values of a watch of `kind`, in words. */
export function describe(kind: WatchKind, prev: string, next: string): string {
  return kind === 'pr' ? describeChange(prev, next) : kind === 'issue' ? describeIssueChange(prev, next) : describeRunChange(prev, next)
}

/** What a watch is called on screen: `PR #11`, `Issue #4`, `Run #123456`. */
export const KIND_LABEL: Record<WatchKind, string> = { pr: 'PR', issue: 'Issue', run: 'Run' }
export const watchName = (w: { kind: WatchKind; number: number }) => `${KIND_LABEL[w.kind]} #${w.number}`

// ---------------------------------------------------------------------------
// A watch over time
// ---------------------------------------------------------------------------
export const watchId = (spec: WatchSpec) => `${spec.kind}:${spec.repo.toLowerCase()}#${spec.number}`

export const newWatch = (spec: WatchSpec, now: number): WatchRow => ({
  id: watchId(spec),
  kind: spec.kind,
  repo: spec.repo,
  number: spec.number,
  title: '',
  addedAt: now,
  expiresAt: now + WATCH_EXPIRY_MS,
  value: '',
  detail: '',
  checkedAt: 0,
  changedAt: 0,
  firedAt: 0,
  fired: '',
  done: false,
})

/** The watch after one look. The first look only takes a baseline; a later, different value fires it. */
export function stepWatch(w: WatchRow, r: Reading, now: number): WatchRow {
  const base = { ...w, checkedAt: now, detail: r.detail, title: r.title || w.title, done: r.done, chips: r.chips, tone: r.tone }
  if (w.value === '') return { ...base, value: r.value, changedAt: now }
  if (r.value === w.value) return base

  return { ...base, value: r.value, changedAt: now, firedAt: now, fired: describe(w.kind, w.value, r.value), expiresAt: now + WATCH_EXPIRY_MS }
}

export const isExpired = (w: WatchRow, now: number) => now >= w.expiresAt

/** Which watches are worth a poll now: not over, not expired. */
export const pollable = (list: readonly WatchRow[], now: number) => list.filter(w => !w.done && !isExpired(w, now))

export type AddResult = { list: WatchRow[]; added: WatchRow | null; error: string }

/** The list with a watch added: a repeat is kept as it was, and a full list refuses rather than dropping one. */
export function addWatch(list: readonly WatchRow[], spec: WatchSpec, now: number): AddResult {
  const live = list.filter(w => !isExpired(w, now))
  const id = watchId(spec)
  const existing = live.find(w => w.id === id)
  if (existing) return { list: live, added: existing, error: '' }
  if (live.length >= WATCHES_KEPT) return { list: live, added: null, error: `That is ${WATCHES_KEPT} watches already. Clear one with /dash-watch clear <number>.` }
  const w = newWatch(spec, now)

  return { list: [...live, w], added: w, error: '' }
}

/** `all`, or a 1-based position in the list. Returns the list without them and how many went. */
export function clearWatches(list: readonly WatchRow[], which: string): { list: WatchRow[]; removed: number } {
  const t = which.trim().toLowerCase()
  if (t === 'all') return { list: [], removed: list.length }
  const n = /^\d+$/.test(t) ? Number(t) : 0
  if (n < 1 || n > list.length) return { list: [...list], removed: 0 }

  return { list: list.filter((_, i) => i !== n - 1), removed: 1 }
}

export type WatchCommand =
  | { cmd: 'add'; spec: WatchSpec }
  | { cmd: 'clear'; which: string }
  | { cmd: 'list' }
  | { cmd: 'help'; reason: string }

const REF_PARSERS: Record<WatchKind, (input: string) => PrRef | null> = { pr: parsePrRef, issue: parseIssueRef, run: parseRunRef }

/** `pr 42`, `issue o/r#3`, `run <url>`, a GitHub URL, a bare number (a pull request), `clear 2`, `clear all`, `list`, or nothing. */
export function parseWatchArgs(args: string): WatchCommand {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { cmd: 'list' }
  const [first, ...rest] = words
  const verb = first.toLowerCase()
  if (verb === 'list') return { cmd: 'list' }
  if (verb === 'clear' || verb === 'rm' || verb === 'remove') return rest[0] ? { cmd: 'clear', which: rest[0] } : { cmd: 'help', reason: 'Clear which one? /dash-watch clear <number> or /dash-watch clear all.' }
  if (verb === 'pr' || verb === 'issue' || verb === 'run') {
    const ref = rest[0] ? REF_PARSERS[verb](rest[0]) : null

    return ref ? { cmd: 'add', spec: { kind: verb, ...ref } } : { cmd: 'help', reason: `Which ${verb}? A number, owner/repo#number or a GitHub URL.` }
  }
  // No verb: a GitHub URL says what it is; a bare number or owner/repo#number is a pull request.
  const pr = parsePrRef(first)
  if (pr) return { cmd: 'add', spec: { kind: 'pr', ...pr } }
  const issue = /\/issues\//i.test(first) ? parseIssueRef(first) : null
  if (issue) return { cmd: 'add', spec: { kind: 'issue', ...issue } }
  const run = /\/actions\/runs\//i.test(first) ? parseRunRef(first) : null
  if (run) return { cmd: 'add', spec: { kind: 'run', ...run } }

  return { cmd: 'help', reason: unsupportedReason(args) }
}

// Other services people may try. Not built: what is said is what would be needed to read each one, so it is clear
// this is a gap and not a typo. No service here is read or contacted; this only recognises a name or a host.
const OTHER_SOURCES: ReadonlyArray<{ name: string; match: RegExp; needs: string }> = [
  { name: 'GitLab', match: /gitlab/i, needs: "GitLab's `glab` command-line tool, logged in" },
  { name: 'Bitbucket', match: /bitbucket/i, needs: 'a Bitbucket MCP server connected to Claude Code' },
  { name: 'Jira', match: /\bjira\b|atlassian\.net/i, needs: 'an Atlassian MCP server connected to Claude Code' },
  { name: 'Linear', match: /linear\.app|\blinear\b/i, needs: 'a Linear MCP server connected to Claude Code' },
  { name: 'Asana', match: /asana/i, needs: 'an Asana MCP server connected to Claude Code' },
  { name: 'Notion', match: /notion\.(so|site)|\bnotion\b/i, needs: 'a Notion MCP server connected to Claude Code' },
  { name: 'Slack', match: /slack\.com|\bslack\b/i, needs: 'a Slack MCP server connected to Claude Code' },
  { name: 'PagerDuty', match: /pagerduty/i, needs: 'a PagerDuty MCP server connected to Claude Code' },
  { name: 'Datadog', match: /datadog|datadoghq/i, needs: 'a Datadog MCP server connected to Claude Code' },
  { name: 'Jenkins', match: /jenkins/i, needs: "a command that reads Jenkins' status, which dev-dash cannot run yet" },
]

/** Why an input that is not a GitHub item was not accepted: names the service if it is one people ask for. */
export function unsupportedReason(input: string): string {
  const mine = 'dev-dash can follow a GitHub pull request, issue or Actions run (through `gh`)'
  const hit = OTHER_SOURCES.find(s => s.match.test(input))
  if (hit) return `${mine}, not ${hit.name} yet. Reading ${hit.name} would need ${hit.needs}, and that is not built.`
  if (/^\s*\S*:\/\//.test(input)) return `${mine}. That link is not one of those.`

  return `${mine}.`
}

export const WATCH_HELP = 'Usage: /dash-watch pr|issue|run <number or URL> · /dash-watch list · /dash-watch clear <number|all>'
