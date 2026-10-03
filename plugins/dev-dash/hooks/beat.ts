// dev-dash: "claude beat", the header's activity trace drawn as an ECG: a flat baseline with a heartbeat on it
// wherever sessions were active. Pure functions only, so they test without a session.
//
// Each sync (one activity sample) is worth BEAT_DOTS columns of line. A quiet sync is the baseline; a busy one is one
// heartbeat: a small bump (P), a sharp spike up (R) with a dip below the baseline (S), and a rounded bump (T), as
// tall as the sync was busy compared with the busiest in view. The line is drawn with solid line characters, one
// column per sample, so it is a connected line and not a scatter of dots: `─` along the baseline, `│` for the steep
// sides, and `╭ ╮ ╰ ╯` where it turns.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Columns of line one sync takes up: enough for the whole heartbeat, short enough to show five or so. */
export const BEAT_DOTS = 6

/** One heartbeat across BEAT_DOTS columns, as a fraction of the room above (+) or below (-) the baseline. */
const HEARTBEAT: readonly number[] = [0.3, 0, 1, -0.8, 0, 0.4]

/** The baseline level (0 = bottom) for `levels` rows: low enough to leave most of the room above it for spikes, with a row below for the dip. */
export const baselineOf = (levels: number) => (levels <= 2 ? 0 : Math.max(1, Math.floor((levels - 1) / 2.2)))

/**
 * The line as one level per column, `dots` of them, newest at the right. Fewer syncs than fit are placed at the
 * right end with a flat baseline to their left. Heights are scaled to the busiest sync in view, at least 1, and a
 * beat is never drawn smaller than a third of full height so a single busy session still shows.
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

/**
 * Levels (0 = bottom, one per column) drawn as `rows` rows of text, top row first. Where the level changes between
 * two columns the line turns in the new column: up is `╯` where it leaves the old level, `│` through the levels
 * between and `╭` where it arrives; down is `╮`, `│` and `╰`. The same level is `─`.
 */
export function drawLine(columns: readonly number[], rows: number): string[] {
  const height = Math.max(1, Math.floor(rows))
  const grid: string[][] = Array.from({ length: height }, () => Array<string>(columns.length).fill(' '))
  const put = (level: number, x: number, ch: string) => {
    grid[height - 1 - level][x] = ch
  }
  let prev = -1
  columns.forEach((raw, x) => {
    const y = clamp(Math.round(raw), 0, height - 1)
    if (prev < 0 || y === prev) {
      put(y, x, '─')
    } else if (y > prev) {
      put(prev, x, '╯')
      for (let level = prev + 1; level < y; level++) put(level, x, '│')
      put(y, x, '╭')
    } else {
      put(prev, x, '╮')
      for (let level = y + 1; level < prev; level++) put(level, x, '│')
      put(y, x, '╰')
    }
    prev = y
  })

  return grid.map(row => row.join(''))
}

/** The header's "claude beat": the last activity as an ECG, `cells` columns wide and `rows` rows tall. */
export function claudeBeat(activity: readonly number[], cells: number, rows = 4): string[] {
  const width = Math.max(1, Math.floor(cells))
  const height = Math.max(1, Math.floor(rows))

  return drawLine(ecgLevels(activity, width, height), height)
}
