import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_ICON_STYLE, ICON_STYLES, iconFor, ICONS, parseIconStyle, sourceOf } from './icons'

describe('icons', () => {
  test('every source has an icon in every style, and the styles differ', () => {
    for (const style of ICON_STYLES) expect(ICONS.github[style].length).toBeGreaterThan(0)
    expect(new Set(ICON_STYLES.map(s => ICONS.github[s])).size).toBe(ICON_STYLES.length)
  })

  test('the default is emoji, which every font has; the official mark is opt-in', () => {
    expect(DEFAULT_ICON_STYLE).toBe('emoji')
    expect(iconFor('github', undefined)).toBe('🐙')
    expect(iconFor('github', 'nerd')).toBe('')
    expect(iconFor('github', 'ascii')).toBe('GH')
  })

  test('the Nerd Font mark is a private-use character, so nothing else can be mistaken for it', () => {
    const cp = ICONS.github.nerd.codePointAt(0) ?? 0
    expect(cp >= 0xe000 && cp <= 0xf8ff).toBe(true)
  })

  test('every watch kind is GitHub', () => {
    for (const k of ['pr', 'issue', 'run'] as const) expect(sourceOf(k)).toBe('github')
  })

  test('the style is read from what the person types', () => {
    expect(parseIconStyle('Nerd')).toBe('nerd')
    expect(parseIconStyle(' emoji ')).toBe('emoji')
    expect(parseIconStyle('ASCII')).toBe('ascii')
    expect(parseIconStyle('')).toBeNull()
    expect(parseIconStyle('fancy')).toBeNull()
  })
})
