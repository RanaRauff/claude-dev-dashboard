// dev-dash: the "buddy", an animated character that can stand in for the claude beat (/dash-beat buddy <name>).
//
// A buddy is a pack made by tools/make-buddy.py: a JSON file with a few moods, each a short list of frames already drawn
// as coloured text cells. This module only checks a pack and picks the frame to show; it runs nothing and reads no
// network. Pure functions, so they test without a session. (The one piece of state, the loaded pack, is a module
// variable the register hook fills and the pane reads.)

export type BuddyMood = 'idle' | 'working' | 'needs'
/** One run of text in one colour: [text, foreground, background]. */
export type BuddyRun = [string, string | null, string | null]
export type BuddyFrame = { ms: number; rows: BuddyRun[][] }
export type BuddyPack = { name: string; cols: number; rows: number; moods: Record<BuddyMood, BuddyFrame[]> }

/** A pack name is a file name inside one folder, so it may not contain a path. */
export const NAME_OK = /^[a-z0-9][a-z0-9_-]{0,31}$/i

const COLOUR = /^#[0-9a-f]{6}$/i
const MAX_FRAMES = 12
const MAX_ROWS = 8
const MAX_COLS = 60

const asRuns = (row: unknown): BuddyRun[] | null => {
  if (!Array.isArray(row)) return null
  const out: BuddyRun[] = []
  for (const r of row) {
    if (!Array.isArray(r) || typeof r[0] !== 'string') return null
    const fg = r[1] ?? null
    const bg = r[2] ?? null
    if ((fg !== null && !(typeof fg === 'string' && COLOUR.test(fg))) || (bg !== null && !(typeof bg === 'string' && COLOUR.test(bg)))) return null
    out.push([r[0], fg, bg])
  }

  return out
}

const asFrames = (v: unknown): BuddyFrame[] | null => {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_FRAMES) return null
  const out: BuddyFrame[] = []
  for (const f of v) {
    if (typeof f !== 'object' || f === null || !Array.isArray((f as BuddyFrame).rows) || (f as BuddyFrame).rows.length > MAX_ROWS) return null
    const rows: BuddyRun[][] = []
    for (const row of (f as BuddyFrame).rows) {
      const runs = asRuns(row)
      if (!runs || runs.reduce((n, r) => n + r[0].length, 0) > MAX_COLS) return null
      rows.push(runs)
    }
    const ms = Number((f as BuddyFrame).ms)
    out.push({ ms: Number.isFinite(ms) ? Math.min(2000, Math.max(50, ms)) : 200, rows })
  }

  return out
}

/** A pack from the text of its file, or null if it is not a pack this version can play. Moods that are missing fall back. */
export function parsePack(text: string): BuddyPack | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as { v?: unknown; name?: unknown; moods?: Record<string, unknown> }
  if (p.v !== 1 || typeof p.moods !== 'object' || p.moods === null) return null
  const idle = asFrames((p.moods.idle as { frames?: unknown } | undefined)?.frames)
  if (!idle) return null
  const working = asFrames((p.moods.working as { frames?: unknown } | undefined)?.frames) ?? idle
  const needs = asFrames((p.moods.needs as { frames?: unknown } | undefined)?.frames) ?? working
  const rows = Math.max(...[idle, working, needs].map(fr => Math.max(...fr.map(f => f.rows.length))))
  const cols = Math.max(...[idle, working, needs].map(fr => Math.max(...fr.map(f => Math.max(0, ...f.rows.map(r => r.reduce((n, x) => n + x[0].length, 0)))))))

  return { name: typeof p.name === 'string' ? p.name : 'buddy', cols, rows, moods: { idle, working, needs } }
}

/** What the buddy is doing: hopping when something needs you, busy when a session is running, else resting. */
export const moodOf = (urgent: number, running: number): BuddyMood => (urgent > 0 ? 'needs' : running > 0 ? 'working' : 'idle')

/** The frame for step `tick` of a mood (the pane steps twice a second). Resting is slower than working. */
export const frameAt = (pack: BuddyPack, mood: BuddyMood, tick: number): BuddyFrame => {
  const frames = pack.moods[mood]
  const every = mood === 'idle' ? 2 : 1

  return frames[Math.floor(Math.max(0, tick) / every) % frames.length]
}

let loaded: BuddyPack | null = null
export const setBuddy = (pack: BuddyPack | null) => {
  loaded = pack
}
export const getBuddy = () => loaded
