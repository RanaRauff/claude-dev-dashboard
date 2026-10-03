import { describe, expect, test } from 'claude-code/testing'

import { THEMES, applyTheme, isTheme, nextTheme, themeByName } from './themes'
import type { Roles } from './themes'

const ROLES = ['you', 'ok', 'warn', 'bad', 'info', 'accent', 'mute'] as const

describe('themes', () => {
  test('there are seven, Auto first, and each gives every role a colour', () => {
    expect(THEMES.map(t => t.id)).toEqual(['auto', 'claude', 'nord', 'neon', 'crt', 'light', 'mono'])
    for (const t of THEMES) for (const role of ROLES) expect(t.tone[role]).toMatch(/^(#[0-9A-F]{6}|[a-z]+)$/)
  })

  test('Auto uses only the named terminal colours, so it follows the terminal theme', () => {
    for (const role of ROLES) expect(THEMES[0].tone[role]).toMatch(/^[a-z]+$/)
  })

  test('names are matched loosely, and unknown ones are not themes', () => {
    expect(themeByName('Nord')?.id).toBe('nord')
    expect(themeByName(' amber crt ')?.id).toBe('crt')
    expect(themeByName('amber-crt')?.id).toBe('crt')
    expect(themeByName('banana')).toBeUndefined()
    expect(isTheme('neon')).toBe(true)
    expect(isTheme('banana')).toBe(false)
  })

  test('the next theme wraps around', () => {
    expect(nextTheme('auto')).toBe('claude')
    expect(nextTheme('mono')).toBe('auto')
  })

  test('applying a theme changes the live table, and an unknown id falls back to Auto', () => {
    const live: Roles = { ...THEMES[0].tone }
    applyTheme(live, 'neon')
    expect(live.you).toBe('#FF6AC1')
    applyTheme(live, 'banana')
    expect(live.you).toBe('yellow')
    applyTheme(live, undefined)
    expect(live.bad).toBe('red')
  })
})
