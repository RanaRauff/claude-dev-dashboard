import { describe, expect, test } from 'claude-code/testing'

import { BEAT_DOTS, baselineOf, claudeBeat, ecgLevels, plotLevels } from './beat'

const braille = (bits: number) => String.fromCharCode(0x2800 + bits)

describe('claude beat: the line as levels', () => {
  test('the baseline sits low enough to leave room above for spikes and a little below for the dip', () => {
    expect(baselineOf(4)).toBe(1)
    expect(baselineOf(8)).toBe(3)
  })

  test('nothing running is a flat baseline across the whole width', () => {
    expect(ecgLevels([], 8, 4)).toEqual(Array(8).fill(1))
    expect(ecgLevels([0, 0, 0], 12, 8)).toEqual(Array(12).fill(3))
  })

  test('one busy sync is one heartbeat: bump, spike, dip below the baseline, rest, bump', () => {
    // 4 levels: baseline 1, room 2 above and 1 below.
    expect(ecgLevels([3], BEAT_DOTS, 4)).toEqual([2, 1, 3, 0, 1, 2])
    // 8 levels: baseline 3, room 4 above and 3 below.
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

describe('claude beat: the line as braille', () => {
  test('the flatline is a row of mid-low dashes', () => {
    expect(claudeBeat([], 4, 1)).toEqual(['⠤⠤⠤⠤'])
  })

  test('a rise is a vertical stroke at the new column; a fall the same, downwards', () => {
    // columns [0, 3]: a dot at the bottom left, then a full-height stroke on the right.
    expect(plotLevels([0, 3], 1, 1)).toEqual([braille(0x40 | 0x08 | 0x10 | 0x20 | 0x80)])
    // columns [3, 0]: a dot at the top left, then a full-height stroke on the right.
    expect(plotLevels([3, 0], 1, 1)).toEqual([braille(0x01 | 0x08 | 0x10 | 0x20 | 0x80)])
  })

  test('one heartbeat across three cells', () => {
    // levels [2, 1, 3, 0, 1, 2]
    expect(claudeBeat([3], 3, 1)).toEqual([braille(0x02 | 0x10 | 0x20) + braille(0x01 | 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x80) + braille(0x40 | 0x04 | 0x10 | 0x20)])
  })

  test('two rows have twice the levels: the spike reaches the top row and the dip stays in the lower one', () => {
    const rows = claudeBeat([3], 3, 2)
    expect(rows.length).toBe(2)
    expect(rows[0]).not.toBe(braille(0).repeat(3))
    expect(rows[1]).not.toBe(braille(0).repeat(3))
  })

  test('a busy trace has dots above and below the flat dashes; an idle one has none', () => {
    const flat = claudeBeat([0, 0, 0, 0], 8, 2).join('')
    const busy = claudeBeat([0, 3, 0, 1, 2, 0, 0, 3], 8, 2).join('')
    expect(flat).not.toBe(busy)
    expect(new Set(flat.replace(/\n/g, '')).size).toBeLessThanOrEqual(2)
    expect(new Set(busy).size).toBeGreaterThan(3)
  })

  test('every character is braille and the size is never below one cell', () => {
    for (const row of claudeBeat([0, 1, 4, 2, 0, 0, 5, 1, 0], 6, 2)) expect(row).toMatch(/^[⠀-⣿]{6}$/)
    expect(claudeBeat([1], 0).length).toBe(1)
    expect(claudeBeat([1], 3, 0).length).toBe(1)
    expect(claudeBeat([1], 0)[0].length).toBe(1)
  })
})
