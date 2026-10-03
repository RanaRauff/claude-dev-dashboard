// dev-dash: the keyboard layer. Pure functions only, so they test without a session.
//
// The pane draws plain Buttons with single-key hotkeys (one digit or one lowercase letter), which
// the engine presses while the pane holds the keyboard. This file holds the one keymap that both the
// legend and the help screen are drawn from, the ids that make rows selectable and mutable, and the
// cursor and snooze arithmetic.

import type { AgentRow, DashSection, DiskRow, LimitRow, PrRow, SessionRow } from '../types'

// ---------------------------------------------------------------------------
// The keymap: one table, drawn as the footer legend and as the help screen
// ---------------------------------------------------------------------------
export type KeyAction =
  | 'down' | 'up' | 'top'
  | 'copy' | 'snooze' | 'dismiss' | 'undo'
  | 'refresh' | 'alerts' | 'help' | 'close'

export type KeyDef = { key: string; label: string; action: KeyAction; group: 'Move' | 'Act' | 'Pane'; help: string }

export const KEYMAP: readonly KeyDef[] = [
  { key: 'j', label: 'down', action: 'down', group: 'Move', help: 'select the next row' },
  { key: 'k', label: 'up', action: 'up', group: 'Move', help: 'select the previous row' },
  { key: 'g', label: 'top', action: 'top', group: 'Move', help: 'select the first row' },
  { key: 'c', label: 'copy', action: 'copy', group: 'Act', help: 'copy the resume command, PR link or a one-line description of the selected row' },
  { key: 's', label: 'snooze', action: 'snooze', group: 'Act', help: 'hide the selected Attention item for 15 minutes, in the pane, the band and the toasts' },
  { key: 'x', label: 'dismiss', action: 'dismiss', group: 'Act', help: 'hide the selected Attention item until it changes' },
  { key: 'u', label: 'undo', action: 'undo', group: 'Act', help: 'bring back everything you snoozed or dismissed' },
  { key: 'r', label: 'refresh', action: 'refresh', group: 'Pane', help: 'refresh everything now, PRs included' },
  { key: 'a', label: 'alerts', action: 'alerts', group: 'Pane', help: 'turn toasts and the chime on or off' },
  { key: 'h', label: 'help', action: 'help', group: 'Pane', help: 'show or hide this key list' },
  { key: 'q', label: 'close', action: 'close', group: 'Pane', help: 'close the pane' },
]

/** Keys a section or another module may not claim as a hotkey. */
export const RESERVED_KEYS: readonly string[] = KEYMAP.map(k => k.key)

export const SNOOZE_MS = 15 * 60_000

// ---------------------------------------------------------------------------
// Row ids. Each is stable while the thing it names is the same thing, and changes when it is a new
// episode (a session that waits again, a new stuck reason), so a dismissal does not hide the next one.
// ---------------------------------------------------------------------------
export const ids = {
  wait: (r: SessionRow) => `wait:${r.id}:${r.stateSince}`,
  stuck: (r: SessionRow) => `stuck:${r.id}:${r.stuck}`,
  risky: (r: SessionRow) => `risky:${r.id}:${r.risky}`,
  disk: (d: DiskRow) => `disk:${d.name}`,
  clash: (file: string) => `clash:${file}`,
  limit: (l: LimitRow) => `limit:${l.kind}`,
  ci: (p: PrRow) => `ci:${p.repo}#${p.number}`,
  review: (p: PrRow) => `review:${p.repo}#${p.number}`,
  session: (r: SessionRow) => `s:${r.id}`,
  agent: (a: AgentRow) => `a:${a.id}`,
  pr: (p: PrRow) => `pr:${p.repo}#${p.number}`,
  rv: (p: PrRow) => `rv:${p.repo}#${p.number}`,
}

export const resumeCommand = (sessionId: string) => `claude --resume ${sessionId}`

// ---------------------------------------------------------------------------
// Snooze and dismiss
// ---------------------------------------------------------------------------
export type Muting = { snoozed: Record<string, number>; dismissed: readonly string[]; now: number }

export const noMuting = (now: number): Muting => ({ snoozed: {}, dismissed: [], now })

export const isMuted = (m: Muting, id: string) => m.dismissed.includes(id) || (m.snoozed[id] ?? 0) > m.now

/** `snoozed` with `id` added and expired entries dropped. */
export const snoozeAdd = (snoozed: Record<string, number>, id: string, now: number): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const [k, until] of Object.entries(snoozed)) if (until > now) out[k] = until
  out[id] = now + SNOOZE_MS

  return out
}

export const dismissAdd = (dismissed: readonly string[], id: string, keep = 200): string[] =>
  dismissed.includes(id) ? [...dismissed] : [...dismissed, id].slice(-keep)

// ---------------------------------------------------------------------------
// The selectable rows, in the order the pane draws them
// ---------------------------------------------------------------------------
export type Item = {
  id: string
  kind: 'attention' | 'session' | 'agent' | 'pr' | 'review'
  /** What `c` puts on the clipboard. */
  copy: string
  /** A short name for the toast after copying. */
  what: string
  /** True for Attention items, the only ones `s` and `x` apply to. */
  canMute: boolean
}

export const itemById = (items: readonly Item[], id: string | null | undefined) => items.find(i => i.id === id)

/** The selected id: the stored one if that row still exists, else the first row (or null with none). */
export const selectedId = (items: readonly Item[], stored: string | null | undefined): string | null =>
  itemById(items, stored)?.id ?? items[0]?.id ?? null

/** The id `delta` rows away from the selected one, stopping at the ends; null with no rows. */
export const moveSelection = (items: readonly Item[], stored: string | null | undefined, delta: number): string | null => {
  if (items.length === 0) return null
  const at = Math.max(0, items.findIndex(i => i.id === selectedId(items, stored)))
  const next = Math.min(items.length - 1, Math.max(0, at + delta))

  return items[next].id
}

/** The row to move to when `id` leaves the list: the one after it, else the one before it, else null. */
export const neighbour = (items: readonly Item[], id: string): string | null => {
  const at = items.findIndex(i => i.id === id)
  if (at < 0) return items[0]?.id ?? null

  return items[at + 1]?.id ?? items[at - 1]?.id ?? null
}

/** Which of the sections that have rows are folded away: their rows are not selectable. */
export const isShown = (folded: readonly DashSection[], id: DashSection) => !folded.includes(id)

/** How many rows the pane draws per section, so the cursor never lands on a row that is not on screen. */
export type Caps = { reviews: number; sessions: number; agents: number }
