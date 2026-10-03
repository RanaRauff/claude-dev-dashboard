import { describe, expect, test } from 'claude-code/testing'

import { BRAND, DEFAULT_ICON_STYLE, ICON_STYLES, iconFor, ICONS, parseIconStyle, sourceOf } from './icons'

describe('icons', () => {
  test('every source has an icon in every style, and the styles differ', () => {
    for (const source of ['github', 'gmail'] as const) {
      for (const style of ICON_STYLES) expect(ICONS[source][style].length).toBeGreaterThan(0)
      expect(new Set(ICON_STYLES.map(s => ICONS[source][s])).size).toBe(ICON_STYLES.length)
    }
  })

  test('the default is the official marks from a Nerd Font', () => {
    expect(DEFAULT_ICON_STYLE).toBe('nerd')
    expect(iconFor('github', undefined)).toBe('')
    expect(iconFor('gmail', undefined)).toBe(String.fromCodePoint(0xf02ab))
    expect(iconFor('github', 'emoji')).toBe('🐙')
    expect(iconFor('gmail', 'ascii')).toBe('@')
  })

  test('the Nerd Font marks are private-use characters, so nothing else can be mistaken for them', () => {
    for (const source of ['github', 'gmail'] as const) {
      const cp = ICONS[source].nerd.codePointAt(0) ?? 0
      expect((cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd)).toBe(true)
    }
  })

  test('mail is Gmail and every GitHub kind is GitHub', () => {
    expect(sourceOf('mail')).toBe('gmail')
    for (const k of ['pr', 'issue', 'run'] as const) expect(sourceOf(k)).toBe('github')
  })

  test('Gmail keeps its red; GitHub keeps the plain text colour', () => {
    expect(BRAND.gmail).toBe('#EA4335')
    expect(BRAND.github).toBeUndefined()
  })

  test('the style is read from what the person types', () => {
    expect(parseIconStyle('Nerd')).toBe('nerd')
    expect(parseIconStyle(' emoji ')).toBe('emoji')
    expect(parseIconStyle('ASCII')).toBe('ascii')
    expect(parseIconStyle('')).toBeNull()
    expect(parseIconStyle('fancy')).toBeNull()
  })
})
