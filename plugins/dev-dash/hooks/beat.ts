// dev-dash: "claude beat", the header's activity trace drawn as a heartbeat-monitor line instead of bars.
// Pure functions only, so they test without a session.
//
// Each braille cell is 2 dots wide and 4 dots tall, so a trace `cells` wide has 2 samples per cell and every
// row of cells adds 4 levels of height. Consecutive samples are joined by a vertical stroke, which is what makes
// it read as a line (a flat baseline when nothing is running, a spike when sessions are) rather than as dots.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// Dot bits of one braille cell, [column][row from the top]: dots 1,2,3,7 on the left, 4,5,6,8 on the right.
const DOT: ReadonlyArray<readonly number[]> = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

/**
 * The last `cells * 2` samples as a continuous line, one string per row of cells, top row first.
 * Fewer samples than that are placed at the right end with a flat baseline to their left, so the trace always
 * fills its width and idle looks like a flatline. The scale is the window's largest value, at least 1.
 */
export function beatLine(values: readonly number[], cells: number, rows = 1): string[] {
  const width = Math.max(1, Math.floor(cells))
  const height = Math.max(1, Math.floor(rows))
  const dots = width * 2
  const levels = height * 4
  const window = values.slice(-dots).map(v => (Number.isFinite(v) ? Math.max(0, v) : 0))
  const samples = [...Array<number>(dots - window.length).fill(0), ...window]
  const max = Math.max(1, ...samples)
  const grid: number[][] = Array.from({ length: height }, () => Array<number>(width).fill(0))
  let prev = -1
  samples.forEach((v, x) => {
    const y = clamp(Math.round((v / max) * (levels - 1)), 0, levels - 1)
    // From the previous level to this one in this column, so a rise or fall is drawn as a stroke.
    const from = prev < 0 ? y : prev
    for (let level = Math.min(from, y); level <= Math.max(from, y); level++) {
      const top = levels - 1 - level
      grid[Math.floor(top / 4)][Math.floor(x / 2)] |= DOT[x % 2][top % 4]
    }
    prev = y
  })

  return grid.map(row => row.map(bits => String.fromCharCode(0x2800 + bits)).join(''))
}
