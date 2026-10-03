// dev-dash: "claude beat", the header's activity trace: a line graph of how much effort Claude was putting in, one
// column per sync, newest at the right. Pure functions only, so they test without a session.
//
// "Effort" is a score made at each sync from what was going on (see effortOf): running sessions count most, then
// busy agents, then waiting sessions, plus how many tool calls this session made since the last sync. The line is
// drawn with solid line characters, so it is one connected stroke and not a scatter of dots: `─` along a level
// stretch, `│` for the steep sides, and `╭ ╮ ╰ ╯` where it turns. Nothing running is a flat line along the bottom.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * How much effort one sync saw. A running session is 3, a busy agent 2, a session waiting on someone 1, and each
 * tool call this session made since the last sync 0.6 (at most 12 of them, so a burst cannot flatten everything else).
 */
export function effortOf(running: number, waiting: number, workingAgents: number, toolCalls: number): number {
  const n = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0)

  return n(running) * 3 + n(waiting) * 1 + n(workingAgents) * 2 + Math.min(n(toolCalls), 12) * 0.6
}

/** The smallest top of the scale, so a little effort looks like a little and not like the most there has ever been. */
export const MIN_SCALE = 6

/**
 * The last `cells` efforts as a level per column (0 = bottom row, `rows - 1` = top), newest at the right. Fewer
 * syncs than fit are placed at the right with zero effort to their left. The top of the scale is the busiest sync in
 * view, but never less than MIN_SCALE.
 */
export function scaleLevels(activity: readonly number[], cells: number, rows: number): number[] {
  const width = Math.max(1, Math.floor(cells))
  const top = Math.max(1, Math.floor(rows)) - 1
  const window = activity.slice(-width).map(v => (Number.isFinite(v) ? Math.max(0, v) : 0))
  const values = [...Array<number>(width - window.length).fill(0), ...window]
  const max = Math.max(MIN_SCALE, ...values)

  return values.map(v => clamp(Math.round((v / max) * top), 0, top))
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

/** The header's "claude beat": the effort history as a connected line graph, `cells` columns wide and `rows` rows tall. */
export function claudeBeat(activity: readonly number[], cells: number, rows = 5): string[] {
  const width = Math.max(1, Math.floor(cells))
  const height = Math.max(1, Math.floor(rows))

  return drawLine(scaleLevels(activity, width, height), height)
}
