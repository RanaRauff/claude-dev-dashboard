// dev-dash: "claude beat", the header's activity trace drawn as an ECG: a flat baseline with a heartbeat on it
// wherever sessions were active. Pure functions only, so they test without a session.
//
// Each sync (one activity sample) is worth BEAT_DOTS dots of line. A quiet sync is the baseline; a busy one is one
// heartbeat: a small bump (P), a sharp spike up (R) with a dip below the baseline (S), and a rounded bump (T), as
// tall as the sync was busy compared with the busiest in view. The line is drawn with braille dots: a cell is
// 2 dots wide and 4 tall, so a trace `cells` wide has 2 dots per cell, and every row of cells adds 4 levels. Dots
// in neighbouring columns are joined by a vertical stroke, which is what makes it read as one continuous line.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Dots of line one sync takes up (3 cells): enough for the whole heartbeat, short enough to show ten or so. */
export const BEAT_DOTS = 6

// Dot bits of one braille cell, [column][row from the top]: dots 1,2,3,7 on the left, 4,5,6,8 on the right.
const DOT: ReadonlyArray<readonly number[]> = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

/** One heartbeat across BEAT_DOTS dots, as a fraction of the room above (+) or below (-) the baseline. */
const HEARTBEAT: readonly number[] = [0.3, 0, 1, -0.8, 0, 0.4]

/** The baseline level (0 = bottom) for `levels` of height: low enough to leave most of the room above it for spikes. */
export const baselineOf = (levels: number) => Math.floor((levels - 1) / 2.2)

/**
 * The line as one level per dot column, `dots` of them, newest at the right. Fewer syncs than fit are placed at
 * the right end with a flat baseline to their left. Heights are scaled to the busiest sync in view, at least 1,
 * and a beat is never drawn smaller than a third of full height so a single busy session still shows.
 */
export function ecgLevels(activity: readonly number[], dots: number, levels: number): number[] {
  const base = baselineOf(levels)
  const up = levels - 1 - base
  const down = base
  const syncs = activity.slice(-Math.ceil(dots / BEAT_DOTS)).map(v => (Number.isFinite(v) ? Math.max(0, v) : 0))
  const max = Math.max(1, ...syncs)
  const line: number[] = []
  for (const a of syncs) {
    if (a <= 0) {
      for (let i = 0; i < BEAT_DOTS; i++) line.push(base)
      continue
    }
    const size = clamp(a / max, 1 / 3, 1)
    for (const f of HEARTBEAT) line.push(clamp(base + Math.round(f * size * (f >= 0 ? up : down)), 0, levels - 1))
  }
  const tail = line.slice(-dots)

  return [...Array<number>(dots - tail.length).fill(base), ...tail]
}

/** Levels (0 = bottom, one per dot column) as braille rows, top row first, with neighbouring columns joined. */
export function plotLevels(columns: readonly number[], cells: number, rows: number): string[] {
  const height = Math.max(1, Math.floor(rows))
  const grid: number[][] = Array.from({ length: height }, () => Array<number>(Math.max(1, Math.floor(cells))).fill(0))
  const levels = height * 4
  let prev = -1
  columns.forEach((raw, x) => {
    const y = clamp(Math.round(raw), 0, levels - 1)
    const from = prev < 0 ? y : prev
    for (let level = Math.min(from, y); level <= Math.max(from, y); level++) {
      const top = levels - 1 - level
      const cell = Math.floor(x / 2)
      if (cell < grid[0].length) grid[Math.floor(top / 4)][cell] |= DOT[x % 2][top % 4]
    }
    prev = y
  })

  return grid.map(row => row.map(bits => String.fromCharCode(0x2800 + bits)).join(''))
}

/** The header's "claude beat": the last activity as an ECG, `cells` wide and `rows` cells tall (4 levels each). */
export function claudeBeat(activity: readonly number[], cells: number, rows = 1): string[] {
  const width = Math.max(1, Math.floor(cells))
  const height = Math.max(1, Math.floor(rows))

  return plotLevels(ecgLevels(activity, width * 2, height * 4), width, height)
}
