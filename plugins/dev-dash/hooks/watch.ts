// dev-dash: /dash-watch. Keep an eye on something and say when it changes.
// Pure functions only, so they test without a session; register.tsx polls `gh` or a mail connector and stores
// the list, watch-view.tsx draws it.
//
// What can be watched: a GitHub pull request, issue or Actions run (through `gh`), and a mail thread by subject
// (through the Gmail connector the person already has). Anything else is told what to connect first.
//
// A watch is something the person typed. It is polled only while the pane is open (and once when it is added, to
// take a baseline), no faster than every 60 seconds, and never toasts.

import type { CiState, WatchChip, WatchKind, WatchRow, WatchTone } from '../types'

export const WATCHES_KEPT = 10
export const WATCH_EXPIRY_MS = 24 * 3_600_000
export const WATCH_EVERY_MS = 60_000

/** The name the Gmail connector goes by in `/mcp`, and the tool that finds threads. */
export const MAIL_SERVERS = ['claude.ai Gmail', 'claude_ai_Gmail'] as const
export const MAIL_TOOL = 'search_threads'

/** What is being watched. For the GitHub kinds `repo` is '' until the caller fills it in from the session. */
export type WatchSpec = { kind: 'pr' | 'issue' | 'run'; repo: string; number: number } | { kind: 'mail'; query: string }

export type PrRef = { repo: string; number: number }

/** What one look found: a comparable `value`, words for the person, the marks to draw, and whether it is over. */
export type Reading = { value: string; detail: string; title: string; done: boolean; chips: WatchChip[]; tone: WatchTone }

const chip = (icon: string, text: string, tone: WatchTone, at?: number): WatchChip => (at === undefined ? { icon, text, tone } : { icon, text, tone, at })

// ---------------------------------------------------------------------------
// Naming a target
// ---------------------------------------------------------------------------
const REPO = '[\\w.-]+\\/[\\w.-]+'

/** `42`, `#42`, `owner/repo#42` or a URL of the kind (`pull`, `issues`). `repo` is '' for a bare number. */
function parseRef(input: string, url: RegExp): PrRef | null {
  const s = input.trim()
  const u = url.exec(s)
  if (u) return { repo: u[1], number: Number(u[2]) }
  const short = new RegExp(`^(${REPO})#(\\d+)$`).exec(s)
  if (short) return { repo: short[1], number: Number(short[2]) }
  const bare = /^#?(\d+)$/.exec(s)

  return bare ? { repo: '', number: Number(bare[1]) } : null
}

const PR_URL = new RegExp(`^https?:\\/\\/github\\.com\\/(${REPO})\\/pull\\/(\\d+)`, 'i')
const ISSUE_URL = new RegExp(`^https?:\\/\\/github\\.com\\/(${REPO})\\/issues\\/(\\d+)`, 'i')
const RUN_URL = new RegExp(`^https?:\\/\\/github\\.com\\/(${REPO})\\/actions\\/runs\\/(\\d+)`, 'i')

export const parsePrRef = (input: string) => parseRef(input, PR_URL)
export const parseIssueRef = (input: string) => parseRef(input, ISSUE_URL)
export const parseRunRef = (input: string) => parseRef(input, RUN_URL)

export const watchId = (spec: WatchSpec) =>
  spec.kind === 'mail' ? `mail:${spec.query.trim().toLowerCase()}` : `${spec.kind}:${spec.repo.toLowerCase()}#${spec.number}`

// ---------------------------------------------------------------------------
// GitHub pull requests
// ---------------------------------------------------------------------------
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
  const title = String(j.title ?? '').trim()
  const value = `${state}|${ci}|${review}|${stage}|${hasConflicts ? 'conflict' : ''}`
  if (state !== 'OPEN') {
    const merged = state === 'MERGED'

    return { value, detail: state.toLowerCase(), title, done: true, chips: [chip(merged ? '⑂' : '✗', state.toLowerCase(), merged ? 'info' : 'mute')], tone: merged ? 'info' : 'mute' }
  }
  const approval = review === 'approved' ? chip('✔', 'approved', 'ok') : review === 'changes requested' ? chip('±', 'changes', 'bad') : chip('○', 'no approval', 'mute')
  const chips = [STAGE_CHIP[stage], ...(hasConflicts ? [chip('⚠', 'conflicts', 'bad')] : []), CI_CHIP[ci], approval]
  const detail = [STAGE_WORDS[stage], hasConflicts ? 'merge conflicts' : '', CI_WORDS[ci], reviewWords(review)].filter(Boolean).join(' · ')
  const tone: WatchTone = ci === 'failing' || hasConflicts || review === 'changes requested' ? 'bad' : stage === 'ready' ? 'ok' : stage === 'draft' ? 'mute' : 'warn'

  return { value, detail, title, done: false, chips, tone }
}

/** What changed between two PR values, in words: `CI failing, approved, ready to merge`, `merged`. */
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

const names = (v: unknown, key: string): string[] =>
  Array.isArray(v) ? v.map(x => String((x && typeof x === 'object' ? (x as Record<string, unknown>)[key] : x) ?? '').trim()).filter(Boolean) : []

/** One `gh issue view --json state,title,stateReason,comments,labels,assignees` answer, or null. */
export function readIssue(json: unknown): Reading | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const state = String(j.state ?? '').toUpperCase()
  if (state !== 'OPEN' && state !== 'CLOSED') return null
  const comments = Array.isArray(j.comments) ? j.comments.length : 0
  const labels = names(j.labels, 'name').sort()
  const assignees = names(j.assignees, 'login')
  const reason = String(j.stateReason ?? '').toUpperCase()
  const isOpen = state === 'OPEN'
  const closedWord = reason === 'NOT_PLANNED' ? 'not planned' : 'closed'
  const detail = isOpen
    ? ['open', plural(comments, 'comment'), assignees.length ? `assigned to ${assignees.join(', ')}` : 'unassigned'].join(' · ')
    : closedWord
  const chips = isOpen
    ? [
        chip('○', 'open', 'ok'),
        chip('💬', String(comments), comments ? 'info' : 'mute'),
        chip('👤', assignees.length ? assignees[0] + (assignees.length > 1 ? ` +${assignees.length - 1}` : '') : 'unassigned', assignees.length ? 'info' : 'mute'),
        ...(labels.length ? [chip('🏷', labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` +${labels.length - 2}` : ''), 'mute')] : []),
      ]
    : [chip('✓', closedWord, 'mute'), chip('💬', String(comments), 'mute')]

  return {
    value: `${state}|${comments}|${labels.join(',')}|${assignees.join(',')}`,
    detail,
    title: String(j.title ?? '').trim(),
    done: !isOpen,
    chips,
    tone: isOpen ? 'info' : 'mute',
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

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

/** One `gh run view --json status,conclusion,...` answer, or null. */
export function readRun(json: unknown): Reading | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const status = String(j.status ?? '').toLowerCase()
  if (!status) return null
  const conclusion = String(j.conclusion ?? '').toLowerCase()
  const isDone = status === 'completed'
  const title = [String(j.workflowName ?? j.name ?? '').trim(), String(j.headBranch ?? '').trim()].filter(Boolean).join(' · ') || String(j.displayTitle ?? '').trim()
  const outcome = !isDone ? (status === 'queued' || status === 'waiting' || status === 'pending' ? 'queued' : 'running') : conclusion === 'success' ? 'passed' : conclusion === 'cancelled' ? 'cancelled' : conclusion === 'skipped' ? 'skipped' : 'failed'
  const look: Record<string, { c: WatchChip; tone: WatchTone }> = {
    queued: { c: chip('◌', 'queued', 'mute'), tone: 'mute' },
    running: { c: chip('◐', 'running', 'warn'), tone: 'warn' },
    passed: { c: chip('✔', 'passed', 'ok'), tone: 'ok' },
    failed: { c: chip('✗', 'failed', 'bad'), tone: 'bad' },
    cancelled: { c: chip('■', 'cancelled', 'mute'), tone: 'mute' },
    skipped: { c: chip('·', 'skipped', 'mute'), tone: 'mute' },
  }

  return { value: `${status}|${conclusion}`, detail: outcome, title, done: isDone, chips: [look[outcome].c], tone: look[outcome].tone }
}

export function describeRunChange(_prev: string, next: string): string {
  const r = readRun({ status: next.split('|')[0], conclusion: next.split('|')[1] })

  return r?.detail ?? 'changed'
}

// ---------------------------------------------------------------------------
// Mail threads, through the Gmail connector
// ---------------------------------------------------------------------------
/** The Gmail search for a subject: its words only, so nothing typed can add operators or quotes to the query. */
export const mailQueryOf = (subject: string) => `subject:(${subject.replace(/["()\\]/g, ' ').replace(/\s+/g, ' ').trim()})`

const timeOf = (v: unknown): number => {
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v
  const s = String(v ?? '').trim()
  if (/^\d{9,13}$/.test(s)) return timeOf(Number(s))
  const t = Date.parse(s)

  return Number.isNaN(t) ? 0 : t
}

/** `Ada Lovelace <ada@x.org>` -> `Ada Lovelace`; `ada@x.org` -> `ada`. */
export const senderName = (v: unknown): string => {
  const s = String((v && typeof v === 'object' ? ((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).email) : v) ?? '').trim()
  const named = /^"?([^"<]+?)"?\s*<[^>]+>$/.exec(s)
  const name = named ? named[1].trim() : s.includes('@') ? s.split('@')[0] : s

  return name.length > 28 ? `${name.slice(0, 27)}…` : name
}

const hash = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0

  return (h >>> 0).toString(36)
}

/**
 * The text of a `search_threads` answer (metadata only: ids, senders, dates) as a reading, or null for nothing to
 * read. `{}` is the connector's way of saying no thread matches. The shape of the thread list is read
 * defensively (`threads`, each with `messages`); anything else still gives a comparable value, so a change is
 * noticed even when it cannot be described.
 */
export function readMail(text: string, subject: string): Reading | null {
  const raw = text.trim()
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { value: `t:${hash(raw)}`, detail: 'results changed', title: subject, done: false, chips: [chip('✉', 'found', 'info')], tone: 'info' }
  }
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const threads = (Array.isArray(data) ? data : Array.isArray(obj.threads) ? obj.threads : []) as unknown[]
  if (threads.length === 0) return { value: 'none', detail: 'no thread yet', title: subject, done: false, chips: [chip('✉', 'none yet', 'mute')], tone: 'mute' }
  let messages = 0
  let latestAt = 0
  let latestFrom = ''
  for (const t of threads) {
    const th = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
    const list = (Array.isArray(th.messages) ? th.messages : Array.isArray(th.relatedMessages) ? th.relatedMessages : Array.isArray(th.related_messages) ? th.related_messages : []) as unknown[]
    messages += list.length || 1
    for (const m of list.length ? list : [th]) {
      const mm = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
      const at = timeOf(mm.date ?? mm.internalDate ?? mm.sentAt ?? mm.timestamp)
      if (at >= latestAt) {
        latestAt = at
        latestFrom = senderName(mm.sender ?? mm.from)
      }
    }
  }
  const detail = `${plural(messages, 'message')}${latestFrom ? ` · last from ${latestFrom}` : ''}`
  const chips = [chip('✉', String(messages), 'info'), ...(latestFrom ? [chip('↩', latestFrom, 'mute', latestAt || undefined)] : [])]

  return { value: `${threads.length}:${messages}:${latestAt}`, detail, title: subject, done: false, chips, tone: 'info' }
}

export function describeMailChange(prev: string, next: string): string {
  if (prev === 'none') return 'thread found'
  if (next === 'none') return 'thread gone'
  const [pt, pm] = prev.split(':').map(Number)
  const [nt, nm] = next.split(':').map(Number)
  if (nt > pt) return 'new thread'
  if (nm > pm) return nm - pm === 1 ? 'new message' : `${nm - pm} new messages`

  return 'changed'
}

// ---------------------------------------------------------------------------
// A watch over time
// ---------------------------------------------------------------------------
export function describe(kind: WatchKind, prev: string, next: string): string {
  return kind === 'pr' ? describeChange(prev, next) : kind === 'issue' ? describeIssueChange(prev, next) : kind === 'run' ? describeRunChange(prev, next) : describeMailChange(prev, next)
}

export const newWatch = (spec: WatchSpec, now: number): WatchRow => ({
  id: watchId(spec),
  kind: spec.kind,
  repo: spec.kind === 'mail' ? '' : spec.repo,
  number: spec.kind === 'mail' ? 0 : spec.number,
  query: spec.kind === 'mail' ? spec.query.trim() : '',
  title: '',
  chips: [],
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
  const base: WatchRow = { ...w, checkedAt: now, detail: r.detail, title: r.title || w.title, done: r.done, chips: r.chips, tone: r.tone, problem: '' }
  if (w.value === '') return { ...base, value: r.value, changedAt: now }
  if (r.value === w.value) return base

  return { ...base, value: r.value, changedAt: now, firedAt: now, fired: describe(w.kind, w.value, r.value), expiresAt: now + WATCH_EXPIRY_MS }
}

/** The watch after a look that failed: what it knew stays, with the reason it could not be refreshed. */
export const stuckWatch = (w: WatchRow, problem: string, now: number): WatchRow => ({ ...w, checkedAt: now, problem })

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

// ---------------------------------------------------------------------------
// The command, and what to say when asked to watch something that cannot be
// ---------------------------------------------------------------------------
export type WatchCommand =
  | { cmd: 'add'; spec: WatchSpec }
  | { cmd: 'clear'; which: string }
  | { cmd: 'list' }
  | { cmd: 'help'; reason: string }
  | { cmd: 'unsupported'; what: string; advice: string }

export const WATCH_HELP =
  'Usage: /dash-watch pr|issue|run <number or URL> · /dash-watch mail <subject words> · /dash-watch list · /dash-watch clear <number|all>'

/** What to connect to watch a thing dev-dash has no adapter for yet, keyed by what the person typed. */
const NEEDS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/jenkins/i, 'Jenkins', 'a Jenkins CLI that is logged in on this machine, or a Jenkins MCP server'],
  [/gitlab|glab/i, 'GitLab', 'the GitLab CLI (`glab auth login`), or a GitLab MCP server'],
  [/bitbucket/i, 'Bitbucket', 'a Bitbucket MCP server'],
  [/jira|atlassian|confluence/i, 'Jira / Atlassian', 'the Atlassian MCP server (`/mcp`, then authenticate)'],
  [/linear/i, 'Linear', 'the Linear MCP server (`/mcp`, then authenticate)'],
  [/asana/i, 'Asana', 'the Asana MCP server (`/mcp`, then authenticate)'],
  [/notion/i, 'Notion', 'the Notion MCP server (`/mcp`, then authenticate)'],
  [/slack/i, 'Slack', 'the Slack MCP server (`/mcp`, then authenticate)'],
  [/pagerduty|pager/i, 'PagerDuty', 'the PagerDuty MCP server (`/mcp`, then authenticate)'],
  [/datadog/i, 'Datadog', 'the Datadog MCP server (`/mcp`, then authenticate)'],
  [/outlook|exchange|imap|yahoo|proton/i, 'that mail provider', 'a mail MCP server for it (Gmail threads are already supported: `/dash-watch mail <subject>`)'],
  [/twitter|tweet|\bx\.com\b|^x$/i, 'X / Twitter', 'an MCP server or CLI you trust for X; it is not reachable by default'],
  [/^https?:\/\/|website|site|page|news|rss|status/i, 'a web page or feed', 'an MCP server that can fetch web pages; dev-dash never fetches URLs itself'],
]

/** The message for a target dev-dash cannot watch yet. */
export function unsupportedAdvice(what: string): string {
  const hit = NEEDS.find(([re]) => re.test(what.trim()))
  const name = hit ? hit[1] : `"${what.trim().slice(0, 40)}"`
  const need = hit ? hit[2] : 'a CLI that is installed and logged in on this machine, or an MCP server for it'

  return `dev-dash cannot watch ${name} yet. It watches GitHub pull requests, issues and Actions runs (through the \`gh\` CLI) and Gmail threads (through your Gmail connector). To watch this it needs ${need}. Connect that first, then ask for it to be added.`
}

const stripQuotes = (s: string) => s.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()

/** `pr 42`, `issue o/r#3`, `run <url>`, `mail Invoice 1042`, a GitHub URL, a bare number, `clear 2`, `clear all`, `list`. */
export function parseWatchArgs(args: string): WatchCommand {
  const text = args.trim()
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return { cmd: 'list' }
  const [first, ...rest] = words
  const verb = first.toLowerCase()
  if (verb === 'list') return { cmd: 'list' }
  if (verb === 'clear' || verb === 'rm' || verb === 'remove') {
    return rest[0] ? { cmd: 'clear', which: rest[0] } : { cmd: 'help', reason: 'Clear which one? /dash-watch clear <number> or /dash-watch clear all.' }
  }
  if (verb === 'mail' || verb === 'email' || verb === 'gmail' || verb === 'thread') {
    const query = stripQuotes(rest.join(' '))

    return query.length >= 2 ? { cmd: 'add', spec: { kind: 'mail', query } } : { cmd: 'help', reason: 'Which mail thread? Give its subject words: /dash-watch mail Invoice 1042.' }
  }
  const kinds: Record<string, [WatchSpec['kind'], (s: string) => PrRef | null]> = {
    pr: ['pr', parsePrRef],
    issue: ['issue', parseIssueRef],
    run: ['run', parseRunRef],
  }
  const k = kinds[verb]
  if (k) {
    const ref = rest[0] ? k[1](rest[0]) : null

    return ref ? { cmd: 'add', spec: { kind: k[0] as 'pr' | 'issue' | 'run', repo: ref.repo, number: ref.number } } : { cmd: 'help', reason: `Which ${verb}? A number, owner/repo#number or a GitHub URL.` }
  }
  // No verb: a GitHub URL says what it is; a bare number or owner/repo#number is a pull request.
  const pr = parsePrRef(first)
  if (pr) return { cmd: 'add', spec: { kind: 'pr', repo: pr.repo, number: pr.number } }
  const issue = parseIssueRef(first)
  if (issue && /\/issues\//i.test(first)) return { cmd: 'add', spec: { kind: 'issue', repo: issue.repo, number: issue.number } }
  const run = parseRunRef(first)
  if (run && /\/actions\/runs\//i.test(first)) return { cmd: 'add', spec: { kind: 'run', repo: run.repo, number: run.number } }

  return { cmd: 'unsupported', what: text, advice: unsupportedAdvice(text) }
}

/** The reply when a watch cannot be read right now, by kind. */
export const problemFor = (kind: WatchKind, reason: 'tool' | 'failed', detail = ''): string =>
  kind === 'mail'
    ? reason === 'tool'
      ? 'Mail watches use your Gmail connector, and it is not connected. Connect it: /mcp, then claude.ai Gmail, then authenticate. (Another mail provider needs its own MCP server.)'
      : `The Gmail connector did not answer${detail ? `: ${detail}` : ''}.`
    : reason === 'tool'
      ? 'This needs the GitHub CLI (`gh`) installed, on your PATH and logged in (`gh auth login`).'
      : `GitHub did not answer${detail ? `: ${detail}` : ''}. Check the number and that you can see that repository.`
