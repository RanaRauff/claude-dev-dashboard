import { describe, expect, test } from 'claude-code/testing'

import { beatLine } from './beat'

describe('claude beat', () => {
  test('nothing running is a flat baseline that fills the width', () => {
    expect(beatLine([], 4)).toEqual(['⣀⣀⣀⣀'])
    expect(beatLine([0, 0, 0], 2)).toEqual(['⣀⣀'])
  })

  test('a rise is drawn as a stroke from the baseline up', () => {
    expect(beatLine([0, 3], 1)).toEqual(['⣸'])
  })

  test('a fall is drawn as a stroke down', () => {
    expect(beatLine([3, 0], 1)).toEqual(['⢹'])
  })

  test('a single recent spike sits at the right end of a flat line', () => {
    expect(beatLine([3], 3)).toEqual(['⣀⣀⣸'])
  })

  test('only the last samples that fit are drawn, and the scale is that window', () => {
    expect(beatLine([0, 0, 0, 0, 9, 0], 1)).toEqual(['⢹'])
    expect(beatLine([50, 50, 0, 3], 1)).toEqual(['⣸'])
  })

  test('two rows have twice the levels: a full-height spike reaches the top row', () => {
    const rows = beatLine([0, 7], 1, 2)
    expect(rows.length).toBe(2)
    expect(rows[0]).toBe(String.fromCharCode(0x2800 + 0xb8))
    expect(rows[1]).toBe(String.fromCharCode(0x2800 + 0xf8))
  })

  test('bad numbers are drawn as zero, and the size is never below one cell', () => {
    expect(beatLine([Number.NaN, -4, Number.POSITIVE_INFINITY], 1)).toEqual(['⣀'])
    expect(beatLine([1], 0).length).toBe(1)
    expect(beatLine([1], 3, 0).length).toBe(1)
  })

  test('every character is braille', () => {
    for (const row of beatLine([0, 1, 4, 2, 0, 0, 5, 1, 0], 6, 2)) expect(row).toMatch(/^[⠀-⣿]+$/)
  })
})
