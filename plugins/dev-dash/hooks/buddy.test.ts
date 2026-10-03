import { describe, expect, test } from 'claude-code/testing'

import { NAME_OK, frameAt, moodOf, parsePack } from './buddy'

const frame = (ch: string, ms = 100) => ({ ms, rows: [[[ch, '#ff8800', null]], []] })
const pack = (extra: object = {}) =>
  JSON.stringify({ v: 1, name: 'fire', moods: { idle: { frames: [frame('a'), frame('b')] }, working: { frames: [frame('c'), frame('d'), frame('e')] } }, ...extra })

describe('buddy packs', () => {
  test('a good pack loads, and missing moods fall back (needs to working, working to idle)', () => {
    const p = parsePack(pack())
    expect(p?.name).toBe('fire')
    expect(p?.moods.idle).toHaveLength(2)
    expect(p?.moods.working).toHaveLength(3)
    expect(p?.moods.needs).toBe(p?.moods.working)
    expect(p?.rows).toBe(2)
    expect(p?.cols).toBe(1)
  })

  test('anything that is not a pack this version can play is refused, not half-loaded', () => {
    expect(parsePack('not json')).toBeNull()
    expect(parsePack('[]')).toBeNull()
    expect(parsePack(JSON.stringify({ v: 2, moods: {} }))).toBeNull()
    expect(parsePack(JSON.stringify({ v: 1, moods: {} }))).toBeNull()
    expect(parsePack(JSON.stringify({ v: 1, moods: { idle: { frames: [] } } }))).toBeNull()
    // a colour that is not #rrggbb could smuggle something into the pane
    expect(parsePack(JSON.stringify({ v: 1, moods: { idle: { frames: [{ ms: 1, rows: [[['x', 'red', null]]] }] } } }))).toBeNull()
    expect(parsePack(JSON.stringify({ v: 1, moods: { idle: { frames: [{ ms: 1, rows: [[['x', null, '#12']]] }] } } }))).toBeNull()
  })

  test('size limits: too many frames, rows or columns are refused', () => {
    const many = Array.from({ length: 13 }, () => frame('x'))
    expect(parsePack(JSON.stringify({ v: 1, moods: { idle: { frames: many } } }))).toBeNull()
    const tall = { ms: 1, rows: Array.from({ length: 9 }, () => [['x', null, null]]) }
    expect(parsePack(JSON.stringify({ v: 1, moods: { idle: { frames: [tall] } } }))).toBeNull()
    const wide = { ms: 1, rows: [[['x'.repeat(61), null, null]]] }
    expect(parsePack(JSON.stringify({ v: 1, moods: { idle: { frames: [wide] } } }))).toBeNull()
  })

  test('names are plain file names, never paths', () => {
    expect(NAME_OK.test('charizard')).toBe(true)
    expect(NAME_OK.test('my-buddy_2')).toBe(true)
    for (const bad of ['', '../x', 'a/b', 'a\b', '.hidden', 'x'.repeat(40), 'a b']) expect(NAME_OK.test(bad)).toBe(false)
  })
})

describe('buddy playback', () => {
  test('the mood follows the pane: needs you, then working, then resting', () => {
    expect(moodOf(1, 3)).toBe('needs')
    expect(moodOf(0, 2)).toBe('working')
    expect(moodOf(0, 0)).toBe('idle')
  })

  test('working steps every half second; resting steps every second', () => {
    const p = parsePack(pack())!
    expect([0, 1, 2, 3, 4].map(t => frameAt(p, 'working', t).rows[0][0][0])).toEqual(['c', 'd', 'e', 'c', 'd'])
    expect([0, 1, 2, 3, 4].map(t => frameAt(p, 'idle', t).rows[0][0][0])).toEqual(['a', 'a', 'b', 'b', 'a'])
  })
})
