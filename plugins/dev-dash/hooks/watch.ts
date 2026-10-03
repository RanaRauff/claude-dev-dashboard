// dev-dash: /dash-watch. Keep an eye on one GitHub PR and say when it changes.
// Pure functions only, so they test without a session; register.tsx polls `gh` and stores the list,
// watch-view.tsx draws it.
//
// A watch is something the person typed. It is polled with `gh` only while the pane is open (and once when
// it is added, to take a baseline), no faster than every 60 seconds, and never toasts.

import type { CiState, WatchRow } from '../types'

export const WATCHES_KEPT = 10
export const WATCH_EXPIRY_MS = 24 * 3_600_000
export const WATCH_EVERY_MS = 60_000

export type PrRef = { repo: string; number: number }

/** What one look at a PR found: a comparable `value`, words for the person, and whether it is over. */
export type Reading = { value: string; detail: string; title: string; done: boolean }

/** `42`, `#42`, `owner/repo#42` or a pull request URL. `repo` is '' for a bare number: the caller fills it in. */
export function parsePrRef(input: string): PrRef | null {
  const s = input.trim()
  const url = /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/i.exec(s)
  if (url) return { repo: url[1], number: Number(url[2]) }
  const short = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(s)
  if (short) return { repo: short[1], number: Number(short[2]) }
  const bare = /^#?(\d+)$/.exec(s)

  return bare ? { repo: '', number: Number(bare[1]) } : null
}

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

/** Where an open PR stands: still a draft, nothing in the way of merging it, or something is. */
export type Stage = 'draft' | 'ready' | 'open'
const STAGE_WORDS: Record<Stage, string> = { draft: 'draft', ready: 'ready to merge', open: 'open' }

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

  return {
    value: `${state}|${ci}|${review}|${stage}|${hasConflicts ? 'conflict' : ''}`,
    detail,
    title: String(j.title ?? '').trim(),
    done: state !== 'OPEN',
  }
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

export const watchId = (ref: PrRef) => `pr:${ref.repo.toLowerCase()}#${ref.number}`

export const newWatch = (ref: PrRef, now: number): WatchRow => ({
  id: watchId(ref),
  kind: 'pr',
  repo: ref.repo,
  number: ref.number,
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
  const base = { ...w, checkedAt: now, detail: r.detail, title: r.title || w.title, done: r.done }
  if (w.value === '') return { ...base, value: r.value, changedAt: now }
  if (r.value === w.value) return base

  return { ...base, value: r.value, changedAt: now, firedAt: now, fired: describeChange(w.value, r.value), expiresAt: now + WATCH_EXPIRY_MS }
}

export const isExpired = (w: WatchRow, now: number) => now >= w.expiresAt

/** Which watches are worth a poll now: not over, not expired. */
export const pollable = (list: readonly WatchRow[], now: number) => list.filter(w => !w.done && !isExpired(w, now))

export type AddResult = { list: WatchRow[]; added: WatchRow | null; error: string }

/** The list with a watch added: a repeat is kept as it was, and a full list refuses rather than dropping one. */
export function addWatch(list: readonly WatchRow[], ref: PrRef, now: number): AddResult {
  const live = list.filter(w => !isExpired(w, now))
  const id = watchId(ref)
  const existing = live.find(w => w.id === id)
  if (existing) return { list: live, added: existing, error: '' }
  if (live.length >= WATCHES_KEPT) return { list: live, added: null, error: `That is ${WATCHES_KEPT} watches already. Clear one with /dash-watch clear <number>.` }
  const w = newWatch(ref, now)

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
  | { cmd: 'add'; ref: PrRef }
  | { cmd: 'clear'; which: string }
  | { cmd: 'list' }
  | { cmd: 'help'; reason: string }

/** `pr 42`, `42`, a URL, `clear 2`, `clear all`, `list`, or nothing. */
export function parseWatchArgs(args: string): WatchCommand {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { cmd: 'list' }
  const [first, ...rest] = words
  const verb = first.toLowerCase()
  if (verb === 'list') return { cmd: 'list' }
  if (verb === 'clear' || verb === 'rm' || verb === 'remove') return rest[0] ? { cmd: 'clear', which: rest[0] } : { cmd: 'help', reason: 'Clear which one? /dash-watch clear <number> or /dash-watch clear all.' }
  const target = verb === 'pr' ? rest[0] : first
  const ref = target ? parsePrRef(target) : null

  return ref ? { cmd: 'add', ref } : { cmd: 'help', reason: 'I can watch a pull request: /dash-watch pr <number or URL>.' }
}

export const WATCH_HELP = 'Usage: /dash-watch pr <number or URL> · /dash-watch list · /dash-watch clear <number|all>'
