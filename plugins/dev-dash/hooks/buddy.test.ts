import { describe, expect, test } from 'claude-code/testing'

import { type CellPack, type SpritePack, NAME_OK, drawScene, frameAt, moodOf, parsePack, toRaster, toRuns } from './buddy'

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
    expect(parsePack(JSON.stringify({ v: 3, moods: { idle: { frames: [frame('a')] } } }))).toBeNull()
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
    const p = parsePack(pack()) as CellPack
    expect([0, 1, 2, 3, 4].map(t => frameAt(p, 'working', t).rows[0][0][0])).toEqual(['c', 'd', 'e', 'c', 'd'])
    expect([0, 1, 2, 3, 4].map(t => frameAt(p, 'idle', t).rows[0][0][0])).toEqual(['a', 'a', 'b', 'b', 'a'])
  })
})

// ---- v2: sprite packs, drawn here at the slot's size
const sprite = (moods: object, extra: object = {}) => JSON.stringify({ v: 2, name: 'ember', palette: { O: '#f08838', K: '#303040' }, mouth: [3, 1], moods, ...extra })
const BLOCK = ['OOKO', 'OOOO', 'O..O'] // 4 x 3 pixels, the mouth at the K's right
const mood = (motion: string, fx: string, frames = [BLOCK]) => ({ motion, fx, ms: 200, frames })
const spritePack = (moods: object) => parsePack(sprite(moods)) as SpritePack
const colours = (cells: { fg: string | null; bg: string | null }[][]) => new Set(cells.flat().flatMap(c => [c.fg, c.bg]).filter(Boolean))
const firstCol = (cells: { ch: string }[][]) => Math.min(...cells.map(l => l.findIndex(c => c.ch !== ' ')).filter(i => i >= 0))

describe('sprite packs (v2)', () => {
  test('a good sprite pack loads; missing moods fall back; unknown motions and effects play as standing with none', () => {
    const p = parsePack(sprite({ idle: mood('sit', 'zzz'), working: mood('moonwalk', 'lasers') }))
    expect(p?.kind).toBe('sprite')
    const s = p as SpritePack
    expect(s.moods.working.motion).toBe('stand')
    expect(s.moods.working.fx).toBe('none')
    expect(s.moods.needs).toBe(s.moods.working)
    expect(s.mouth).toEqual([3, 1])
  })

  test('bad colours, letters with no colour, and oversize sprites are refused', () => {
    const ok = { idle: mood('sit', 'none') }
    expect(parsePack(sprite(ok, { palette: { O: 'orange' } }))).toBeNull()
    expect(parsePack(sprite(ok, { palette: { OO: '#f08838' } }))).toBeNull()
    expect(parsePack(sprite(ok, { palette: {} }))).toBeNull()
    expect(parsePack(sprite({ idle: mood('sit', 'none', [['OXO']]) }))).toBeNull()
    expect(parsePack(sprite({ idle: mood('sit', 'none', [Array.from({ length: 17 }, () => 'O')]) }))).toBeNull()
    expect(parsePack(sprite({ idle: mood('sit', 'none', [['O'.repeat(41)]]) }))).toBeNull()
    expect(parsePack(sprite({ idle: mood('sit', 'none', Array.from({ length: 13 }, () => BLOCK)) }))).toBeNull()
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'[i], '#000000']))
    expect(parsePack(sprite(ok, { palette: many }))).toBeNull()
  })
})

describe('the buddy scene', () => {
  test('it is exactly the slot: cols x rows cells, in the sprite colours, and the same time draws the same scene', () => {
    const p = spritePack({ idle: mood('stand', 'none') })
    const cells = drawScene(p, 'idle', 1234, 24, 5)
    expect(cells).toHaveLength(5)
    for (const line of cells) expect(line).toHaveLength(24)
    expect(colours(cells)).toEqual(new Set(['#f08838', '#303040']))
    expect(drawScene(p, 'idle', 1234, 24, 5)).toEqual(cells)
    // only half blocks and spaces: two pixels a cell
    for (const c of cells.flat()) expect(' ▀▄█').toContain(c.ch)
  })

  test('walking crosses the slot and turns round at the end', () => {
    const p = spritePack({ idle: mood('walk', 'none') })
    const at = (t: number) => firstCol(drawScene(p, 'idle', t, 20, 5))
    expect(at(0)).toBe(0)
    expect(at(2000)).toBeGreaterThan(at(0))
    // after reaching the right edge it heads back, drawn mirrored (the K eye moves to the other side)
    const back = drawScene(p, 'idle', 5000, 20, 5)
    const eye = back.flat().findIndex(c => c.fg === '#303040')
    const there = drawScene(p, 'idle', 1000, 20, 5).flat().findIndex(c => c.fg === '#303040')
    expect(eye).toBeGreaterThanOrEqual(0)
    expect(there).toBeGreaterThanOrEqual(0)
    expect((eye % 20) - firstCol(back)).not.toBe((there % 20) - firstCol(drawScene(p, 'idle', 1000, 20, 5)))
  })

  test('fire comes out of the mouth and reaches across the slot', () => {
    const p = spritePack({ idle: mood('stand', 'fire') })
    const cells = drawScene(p, 'idle', 1500, 30, 5)
    const hot = cells.flat().map((c, i) => ({ c, x: i % 30 })).filter(({ c }) => c.fg && !['#f08838', '#303040'].includes(c.fg))
    expect(Math.max(...hot.map(h => h.x))).toBeGreaterThan(20)
  })

  test('sleeping draws z letters beside it; a narrow pane (4 rows) still fits a 10-pixel sprite', () => {
    const p = spritePack({ idle: mood('sit', 'zzz', [Array.from({ length: 10 }, () => 'OOOO')]) })
    const cells = drawScene(p, 'idle', 2000, 20, 4)
    expect(cells).toHaveLength(4)
    expect(cells.flat().some(c => c.ch === 'z' || c.ch === 'Z')).toBe(true)
    expect(cells.flat().filter(c => c.ch === '█').length).toBeGreaterThan(0)
  })

  test('runs drop trailing blanks; a Raster gets 12 bytes per cell', () => {
    const p = spritePack({ idle: mood('stand', 'none') })
    const cells = drawScene(p, 'idle', 0, 10, 2)
    const runs = toRuns(cells)
    expect(runs).toHaveLength(2)
    expect(runs[0].reduce((n, r) => n + r[0].length, 0)).toBeLessThan(10)
    expect(atob(toRaster(cells)).length).toBe(10 * 2 * 12)
  })
})
