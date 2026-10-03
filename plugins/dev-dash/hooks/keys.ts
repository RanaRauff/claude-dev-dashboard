// dev-dash: row ids, the actions a row offers, and snooze/dismiss. Pure functions only, so they test without a session.
//
// The pane is driven with the generic keys the engine already gives a focused pane: Tab and the arrow keys move
// the focus ring over the Buttons, Enter presses the one in the ring, Esc gives the keyboard back to the prompt and
// ctrl+x tab takes it back. Every row has a small marker Button as its stop in the ring, and pressing it opens the
// row's actions (copy, snooze, dismiss). No letter hotkeys.

import type { AgentRow, DiskRow, LimitRow, PrRow, SessionRow } from '../types'
import type { DashSection } from '../types'

// ---------------------------------------------------------------------------
// The keys, as the help panel explains them
// ---------------------------------------------------------------------------
export const HELP_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['↑ ↓  or  Tab', 'move the highlight to the previous or next row or button'],
  ['Enter', 'press the highlighted button; on a row, open its actions'],
  ['Esc', 'give the keyboard back to the prompt'],
  ['ctrl+x tab', 'bring the keyboard back to this pane (or type /dash)'],
  ['1 – 9', 'fold or unfold a section'],
]

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
// The rows that can be opened, in the order the pane draws them
// ---------------------------------------------------------------------------
export type Item = {
  id: string
  kind: 'attention' | 'session' | 'agent' | 'pr' | 'review'
  /** What Copy puts on the clipboard. */
  copy: string
  /** What the copy button is called, and what the toast says was copied. */
  what: string
  /** True for Attention items, the only ones that can be snoozed or dismissed. */
  canMute: boolean
}

export const itemById = (items: readonly Item[], id: string | null | undefined) => items.find(i => i.id === id)

export type RowAction = { id: 'copy' | 'snooze' | 'dismiss'; label: string }

/** The buttons a row shows when it is opened. Only Attention items can be muted. */
export const actionsFor = (item: Item): RowAction[] => [
  { id: 'copy', label: `copy ${item.what}` },
  ...(item.canMute ? ([{ id: 'snooze', label: 'snooze 15m' }, { id: 'dismiss', label: 'dismiss' }] as const) : []),
]

/** Which of the sections that have rows are folded away: their rows are not shown. */
export const isShown = (folded: readonly DashSection[], id: DashSection) => !folded.includes(id)

/** How many rows the pane draws per section. */
export type Caps = { reviews: number; sessions: number; agents: number }
