import { describe, expect, test } from 'claude-code/testing'

import { claudeBeat, drawLine, effortOf, MIN_SCALE, scaleLevels, tipRow } from './beat'

describe('claude beat: effort', () => {
  test('running sessions count most, then busy agents, then waiting, plus tool calls', () => {
    expect(effortOf(0, 0, 0, 0)).toBe(0)
    expect(effortOf(1, 0, 0, 0)).toBe(3)
    expect(effortOf(0, 0, 1, 0)).toBe(2)
    expect(effortOf(0, 1, 0, 0)).toBe(1)
    expect(Math.round(effortOf(2, 1, 1, 5) * 1000) / 1000).toBe(12)
  })

  test('a burst of tool calls is capped so it cannot flatten everything else', () => {
    expect(effortOf(0, 0, 0, 12)).toBe(effortOf(0, 0, 0, 500))
  })

  test('bad numbers count as nothing', () => {
    expect(effortOf(Number.NaN, -2, Number.POSITIVE_INFINITY, Number.NaN)).toBe(0)
  })
})

describe('claude beat: scaling to levels', () => {
  test('values become rows from the bottom, scaled to the busiest in view', () => {
    expect(scaleLevels([0, 3, 6, 3, 0], 5, 5)).toEqual([0, 2, 4, 2, 0])
    expect(scaleLevels([0, 12, 6], 3, 5)).toEqual([0, 4, 2])
  })

  test('a little effort looks like a little: the top of the scale is never below the minimum', () => {
    expect(scaleLevels([1], 1, 5)).toEqual([Math.round((1 / MIN_SCALE) * 4)])
    expect(Math.max(...scaleLevels([1, 1, 1], 3, 5))).toBeLessThan(2)
  })

  test('newest at the right, zero effort to the left, only what fits is kept', () => {
    expect(scaleLevels([6], 4, 5)).toEqual([0, 0, 0, 4])
    expect(scaleLevels([6, 0, 0, 0, 6, 3], 3, 5)).toEqual([0, 4, 2])
  })

  test('bad numbers are zero effort', () => {
    expect(scaleLevels([Number.NaN, -3, Number.POSITIVE_INFINITY], 3, 5)).toEqual([0, 0, 0])
  })
})

describe('claude beat: the line as solid characters', () => {
  test('a rise turns up in the new column and a fall turns down', () => {
    // up from level 0 to 2: ╯ where it leaves, │ between, ╭ where it arrives
    expect(drawLine([0, 2], 3)).toEqual([' ╭', ' │', '─╯'])
    // down from level 2 to 0: ╮ where it leaves, │ between, ╰ where it arrives
    expect(drawLine([2, 0], 3)).toEqual(['─╮', ' │', ' ╰'])
  })

  test('nothing running is one unbroken run of ─ along the bottom', () => {
    expect(claudeBeat([], 4, 5)).toEqual(['    ', '    ', '    ', '    ', '────'])
    expect(claudeBeat([0, 0, 0], 4, 5)).toEqual(['    ', '    ', '    ', '    ', '────'])
  })

  test('rising and falling effort is a connected mountain', () => {
    expect(claudeBeat([0, 3, 6, 3, 0], 5, 5)).toEqual(['  ╭╮ ', '  ││ ', ' ╭╯╰╮', ' │  │', '─╯  ╰'])
  })

  test('different effort gives a visibly different line, with ups and downs', () => {
    const calm = claudeBeat([1, 1, 2, 1, 1, 1], 6, 5).join('\n')
    const busy = claudeBeat([1, 6, 2, 9, 4, 12], 6, 5).join('\n')
    expect(calm).not.toBe(busy)
    // the busy one reaches the top row, the calm one does not
    expect(claudeBeat([1, 6, 2, 9, 4, 12], 6, 5)[0].trim().length).toBeGreaterThan(0)
    expect(claudeBeat([1, 1, 2, 1, 1, 1], 6, 5)[0].trim().length).toBe(0)
  })

  test('every column has the line in it, at every height', () => {
    for (const rows of [3, 4, 5, 6]) {
      const grid = claudeBeat([0, 3, 0, 1, 2, 0, 0, 3, 9, 12], 24, rows)
      for (let x = 0; x < 24; x++) expect(grid.some(r => r[x] !== ' ')).toBe(true)
    }
  })

  test('only line characters and spaces are used', () => {
    expect(claudeBeat([0, 4, 1, 9, 2, 12, 0, 0, 5], 24, 5).join('\n')).toMatch(/^[─│╭╮╰╯ \n]+$/)
  })

  test('the size is never below one column and one row', () => {
    expect(claudeBeat([1], 0).length).toBe(5)
    expect(claudeBeat([1], 0)[0].length).toBe(1)
    expect(claudeBeat([1], 3, 0).length).toBe(1)
    expect(claudeBeat([1], 3, 0)[0].length).toBe(3)
  })
})

describe('claude beat: the blinking tip', () => {
  test('it is on the row of the newest sample only, however steep the last step', () => {
    expect(tipRow([0, 0, 0], 3, 5)).toBe(4)
    expect(tipRow([0, 0, 12], 3, 5)).toBe(0)
    expect(tipRow([12, 12, 0], 3, 5)).toBe(4)
    expect(tipRow([], 4, 5)).toBe(4)
  })
})
