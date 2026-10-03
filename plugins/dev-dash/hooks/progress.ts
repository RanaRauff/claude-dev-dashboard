// dev-dash: per-session progress data (plan progress, sources fetched, files changed this turn).
// Pure functions only, so they test without a session. register.tsx collects, progress-view.tsx draws.

import type { ChangedFile, PlanProgress, SourceRow } from '../types'

export const SOURCES_KEPT = 20
export const TURN_FILES_KEPT = 12

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Progress of the list a session keeps with TodoWrite; null when the input has no todos. */
export function planOf(input: Record<string, unknown>): PlanProgress | null {
  const todos = input.todos
  if (!Array.isArray(todos) || todos.length === 0) return null
  const items = todos.map(t => (t && typeof t === 'object' ? (t as Record<string, unknown>) : {}))
  const done = items.filter(t => t.status === 'completed').length
  const active = items.find(t => t.status === 'in_progress') ?? items.find(t => t.status === 'pending')
  const current = active ? text(active.activeForm) || text(active.content) : ''

  return { done, total: items.length, current }
}

/** A URL a session fetched or a query it searched, from one tool call; null for any other tool. */
export function sourceOf(tool: string, input: Record<string, unknown>, at: number): SourceRow | null {
  if (tool === 'WebFetch' && text(input.url)) return { at, kind: 'fetch', label: text(input.url) }
  if (tool === 'WebSearch' && text(input.query)) return { at, kind: 'search', label: text(input.query) }

  return null
}

/** Newest first, one entry per source (a repeat moves to the front), capped. */
export function addSource(list: readonly SourceRow[], next: SourceRow, keep = SOURCES_KEPT): SourceRow[] {
  const rest = list.filter(s => !(s.kind === next.kind && s.label === next.label))

  return [next, ...rest].slice(0, keep)
}

/** `https://example.com/a/b?x=1` -> `example.com/a/b`; anything else comes back as it was. */
export function shortUrl(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)/i.exec(url)
  if (!m) return url
  const path = m[2].replace(/\/+$/, '')

  return `${m[1].replace(/^www\./, '')}${path}`
}

/** Output of `git diff --numstat`: `added<TAB>removed<TAB>path`, with `-` for binary files. */
export function parseNumstat(out: string): ChangedFile[] {
  const files: ChangedFile[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (m) files.push({ path: m[3], added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]) })
  }

  return files
}

/** Lines in a file's text, for a new file git has no diff for yet. */
export const countLines = (s: string) => (s === '' ? 0 : s.split(/\r?\n/).length - (s.endsWith('\n') ? 1 : 0))

export const totals = (files: readonly ChangedFile[]) => ({
  added: files.reduce((n, f) => n + f.added, 0),
  removed: files.reduce((n, f) => n + f.removed, 0),
})

/** A plan counts as live while it is unfinished, or for a while after it finished. */
export const PLAN_LINGER_MS = 10 * 60_000
export const isPlanLive = (p: PlanProgress | null | undefined, now: number, updatedAt: number) =>
  !!p && (p.done < p.total || now - updatedAt < PLAN_LINGER_MS)
