import { describe, expect, test } from 'claude-code/testing'

import { BEAT_DOTS, baselineOf, claudeBeat, drawLine, ecgLevels } from './beat'

describe('claude beat: the line as levels', () => {
  test('the baseline sits low enough to leave room above for spikes and a row below for the dip', () => {
    expect(baselineOf(2)).toBe(0)
    expect(baselineOf(3)).toBe(1)
    expect(baselineOf(4)).toBe(1)
    expect(baselineOf(8)).toBe(3)
  })

  test('nothing running is a flat baseline across the whole width', () => {
    expect(ecgLevels([], 8, 4)).toEqual(Array(8).fill(1))
    expect(ecgLevels([0, 0, 0], 12, 8)).toEqual(Array(12).fill(3))
  })

  test('one busy sync is one heartbeat: bump, spike, dip below the baseline, rest, bump', () => {
    // 4 rows: baseline 1, room 2 above and 1 below.
    expect(ecgLevels([3], BEAT_DOTS, 4)).toEqual([2, 1, 3, 0, 1, 2])
    // 3 rows: baseline 1, room 1 above and 1 below, so the small bumps flatten into the baseline.
    expect(ecgLevels([3], BEAT_DOTS, 3)).toEqual([1, 1, 2, 0, 1, 1])
    // 8 rows: baseline 3, room 4 above and 3 below.
    expect(ecgLevels([3], BEAT_DOTS, 8)).toEqual([4, 3, 7, 1, 3, 5])
  })

  test('the spike goes up and the dip goes below the baseline', () => {
    const levels = ecgLevels([5], BEAT_DOTS, 8)
    expect(Math.max(...levels)).toBe(7)
    expect(Math.min(...levels)).toBeLessThan(baselineOf(8))
  })

  test('a quieter sync is a smaller heartbeat than the busiest one in view, but never vanishes', () => {
    const levels = ecgLevels([4, 1], BEAT_DOTS * 2, 8)
    const big = levels.slice(0, BEAT_DOTS)
    const small = levels.slice(BEAT_DOTS)
    expect(Math.max(...big)).toBeGreaterThan(Math.max(...small))
    expect(Math.max(...small)).toBeGreaterThan(baselineOf(8))
  })

  test('newest at the right, a flat baseline to the left, and only what fits is kept', () => {
    const levels = ecgLevels([2], BEAT_DOTS + 4, 4)
    expect(levels.length).toBe(BEAT_DOTS + 4)
    expect(levels.slice(0, 4)).toEqual([1, 1, 1, 1])
    expect(levels.slice(4)).toEqual([2, 1, 3, 0, 1, 2])
    const many = ecgLevels([1, 0, 0, 0, 0, 0, 0, 2], 12, 4)
    expect(many.length).toBe(12)
    expect(many.slice(0, BEAT_DOTS)).toEqual(Array(BEAT_DOTS).fill(1))
  })

  test('bad numbers are a quiet sync', () => {
    expect(ecgLevels([Number.NaN, -3, Number.POSITIVE_INFINITY], 6, 4)).toEqual(Array(6).fill(1))
  })
})

describe('claude beat: the line as solid characters', () => {
  test('the flatline is one unbroken run of ─ on the baseline row', () => {
    expect(claudeBeat([], 4, 4)).toEqual(['    ', '    ', '────', '    '])
  })

  test('a rise turns up in the new column and a fall turns down', () => {
    // up from level 0 to 2: ╯ where it leaves, │ between, ╭ where it arrives
    expect(drawLine([0, 2], 3)).toEqual([' ╭', ' │', '─╯'])
    // down from level 2 to 0: ╮ where it leaves, │ between, ╰ where it arrives
    expect(drawLine([2, 0], 3)).toEqual(['─╮', ' │', ' ╰'])
  })

  test('one heartbeat across six columns is a connected ECG', () => {
    expect(claudeBeat([3], 6, 4)).toEqual(['  ╭╮  ', '─╮││ ╭', ' ╰╯│╭╯', '   ╰╯ '])
  })

  test('every column has the line in it: no gaps between neighbours', () => {
    for (const rows of [3, 4, 5]) {
      const grid = claudeBeat([0, 3, 0, 1, 2, 0, 0, 3], 24, rows)
      for (let x = 0; x < 24; x++) expect(grid.some(r => r[x] !== ' ')).toBe(true)
    }
  })

  test('the spike reaches the top row and the dip reaches the bottom row', () => {
    const grid = claudeBeat([4], 6, 4)
    expect(grid[0].trim().length).toBeGreaterThan(0)
    expect(grid[3].trim().length).toBeGreaterThan(0)
  })

  test('an idle trace and a busy trace differ, and only line characters and spaces are used', () => {
    const idle = claudeBeat([0, 0, 0, 0], 24, 4).join('\n')
    const busy = claudeBeat([0, 3, 0, 1, 2, 0, 0, 3], 24, 4).join('\n')
    expect(idle).not.toBe(busy)
    expect(busy).toMatch(/^[─│╭╮╰╯ \n]+$/)
  })

  test('the size is never below one column and one row', () => {
    expect(claudeBeat([1], 0).length).toBe(4)
    expect(claudeBeat([1], 0)[0].length).toBe(1)
    expect(claudeBeat([1], 3, 0).length).toBe(1)
    expect(claudeBeat([1], 3, 0)[0].length).toBe(3)
  })
})
