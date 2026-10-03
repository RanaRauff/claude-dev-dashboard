// dev-dash: the "buddy", an animated character that can stand in for the claude beat (/dash-beat buddy <name>).
//
// A buddy is a pack made by tools/make-buddy.py: a JSON file this module checks and plays back; it runs nothing and
// reads no network. Pure functions, so they test without a session. (The one piece of state, the loaded pack, is a
// module variable the register hook fills and the pane reads.)
//
// Two kinds of pack:
// - v1, "cells": every frame already drawn as coloured text runs. Played as is.
// - v2, "sprite": small pixel sprites (a palette and rows of palette letters, about 10 pixels tall) plus, per mood, a
//   motion and an effect. The scene is drawn here, at the slot's own size and the current time: the sprite walks,
//   flies, hops or sleeps across the beat's slot while its effect (fire, sparks, a shadow ball, water, z's) fills the
//   rest, two pixels per terminal row in half blocks (▀ ▄ █, the block elements every terminal font has).

export type BuddyMood = 'idle' | 'working' | 'needs'
/** One run of text in one colour: [text, foreground, background]. */
export type BuddyRun = [string, string | null, string | null]
export type BuddyFrame = { ms: number; rows: BuddyRun[][] }

export const MOTIONS = ['sit', 'stand', 'walk', 'run', 'fly', 'float', 'hop', 'shake'] as const
export const EFFECTS = ['none', 'zzz', 'sparks', 'thunder', 'fire', 'shadow', 'water', 'leaves', 'dust'] as const
export type BuddyMotion = (typeof MOTIONS)[number]
export type BuddyFx = (typeof EFFECTS)[number]
/** One mood of a sprite pack: how it moves, what it gives off, and its frames (rows of palette letters, '.' is clear). */
export type SpriteMood = { motion: BuddyMotion; fx: BuddyFx; ms: number; frames: string[][] }

export type CellPack = { kind: 'cells'; name: string; cols: number; rows: number; moods: Record<BuddyMood, BuddyFrame[]> }
export type SpritePack = {
  kind: 'sprite'
  name: string
  palette: Record<string, string>
  /** Where effects come out (the mouth), in sprite pixels with the sprite facing right. */
  mouth: [number, number]
  moods: Record<BuddyMood, SpriteMood>
}
export type BuddyPack = CellPack | SpritePack

/** A pack name is a file name inside one folder, so it may not contain a path. */
export const NAME_OK = /^[a-z0-9][a-z0-9_-]{0,31}$/i

const COLOUR = /^#[0-9a-f]{6}$/i
const MAX_FRAMES = 12
const MAX_ROWS = 8
const MAX_COLS = 60
const MAX_SPRITE_H = 16
const MAX_SPRITE_W = 40
const MAX_PALETTE = 32
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ------------------------------------------------------------------------------------------------------- v1 cells
const asRuns = (row: unknown): BuddyRun[] | null => {
  if (!Array.isArray(row)) return null
  const out: BuddyRun[] = []
  for (const r of row) {
    if (!Array.isArray(r) || typeof r[0] !== 'string') return null
    const fg = r[1] ?? null
    const bg = r[2] ?? null
    if ((fg !== null && !(typeof fg === 'string' && COLOUR.test(fg))) || (bg !== null && !(typeof bg === 'string' && COLOUR.test(bg)))) return null
    out.push([r[0], fg, bg])
  }

  return out
}

const asFrames = (v: unknown): BuddyFrame[] | null => {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_FRAMES) return null
  const out: BuddyFrame[] = []
  for (const f of v) {
    if (typeof f !== 'object' || f === null || !Array.isArray((f as BuddyFrame).rows) || (f as BuddyFrame).rows.length > MAX_ROWS) return null
    const rows: BuddyRun[][] = []
    for (const row of (f as BuddyFrame).rows) {
      const runs = asRuns(row)
      if (!runs || runs.reduce((n, r) => n + r[0].length, 0) > MAX_COLS) return null
      rows.push(runs)
    }
    const ms = Number((f as BuddyFrame).ms)
    out.push({ ms: Number.isFinite(ms) ? clamp(ms, 50, 2000) : 200, rows })
  }

  return out
}

const parseCells = (p: { name?: unknown; moods: Record<string, unknown> }): CellPack | null => {
  const idle = asFrames((p.moods.idle as { frames?: unknown } | undefined)?.frames)
  if (!idle) return null
  const working = asFrames((p.moods.working as { frames?: unknown } | undefined)?.frames) ?? idle
  const needs = asFrames((p.moods.needs as { frames?: unknown } | undefined)?.frames) ?? working
  const rows = Math.max(...[idle, working, needs].map(fr => Math.max(...fr.map(f => f.rows.length))))
  const cols = Math.max(...[idle, working, needs].map(fr => Math.max(...fr.map(f => Math.max(0, ...f.rows.map(r => r.reduce((n, x) => n + x[0].length, 0)))))))

  return { kind: 'cells', name: typeof p.name === 'string' ? p.name : 'buddy', cols, rows, moods: { idle, working, needs } }
}

// ------------------------------------------------------------------------------------------------------ v2 sprites
const asSpriteMood = (v: unknown, palette: Record<string, string>): SpriteMood | null => {
  if (typeof v !== 'object' || v === null) return null
  const m = v as { motion?: unknown; fx?: unknown; ms?: unknown; frames?: unknown }
  if (!Array.isArray(m.frames) || m.frames.length === 0 || m.frames.length > MAX_FRAMES) return null
  const frames: string[][] = []
  for (const f of m.frames) {
    if (!Array.isArray(f) || f.length === 0 || f.length > MAX_SPRITE_H) return null
    for (const row of f) {
      if (typeof row !== 'string' || row.length > MAX_SPRITE_W) return null
      for (const ch of row) if (ch !== '.' && !(ch in palette)) return null
    }
    frames.push(f as string[])
  }
  const ms = Number(m.ms)
  // An unknown motion or effect (from a newer tool) plays as standing still with none, rather than refusing the pack.
  const motion = (MOTIONS as readonly string[]).includes(String(m.motion)) ? (m.motion as BuddyMotion) : 'stand'
  const fx = (EFFECTS as readonly string[]).includes(String(m.fx)) ? (m.fx as BuddyFx) : 'none'

  return { motion, fx, ms: Number.isFinite(ms) ? clamp(ms, 60, 2000) : 250, frames }
}

const parseSprite = (p: { name?: unknown; palette?: unknown; mouth?: unknown; moods: Record<string, unknown> }): SpritePack | null => {
  if (typeof p.palette !== 'object' || p.palette === null || Array.isArray(p.palette)) return null
  const entries = Object.entries(p.palette as Record<string, unknown>)
  if (entries.length === 0 || entries.length > MAX_PALETTE) return null
  const palette: Record<string, string> = Object.create(null)
  for (const [k, c] of entries) {
    if (!/^[A-Za-z0-9]$/.test(k) || typeof c !== 'string' || !COLOUR.test(c)) return null
    palette[k] = c.toLowerCase()
  }
  const idle = asSpriteMood(p.moods.idle, palette)
  if (!idle) return null
  const working = asSpriteMood(p.moods.working, palette) ?? idle
  const needs = asSpriteMood(p.moods.needs, palette) ?? working
  const mouth: [number, number] =
    Array.isArray(p.mouth) && p.mouth.length === 2 && p.mouth.every(n => Number.isInteger(n) && n >= 0 && n < MAX_SPRITE_W)
      ? [p.mouth[0] as number, p.mouth[1] as number]
      : [Math.max(...idle.frames[0].map(r => r.length)) - 1, Math.floor(idle.frames[0].length / 2)]

  return { kind: 'sprite', name: typeof p.name === 'string' ? p.name : 'buddy', palette, mouth, moods: { idle, working, needs } }
}

/** A pack from the text of its file, or null if it is not a pack this version can play. Moods that are missing fall back. */
export function parsePack(text: string): BuddyPack | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as { v?: unknown; name?: unknown; palette?: unknown; mouth?: unknown; moods?: Record<string, unknown> }
  if (typeof p.moods !== 'object' || p.moods === null) return null
  if (p.v === 1) return parseCells(p as { moods: Record<string, unknown> })
  if (p.v === 2) return parseSprite(p as { moods: Record<string, unknown> })

  return null
}

/** What the buddy is doing: hopping when something needs you, busy when a session is running, else resting. */
export const moodOf = (urgent: number, running: number): BuddyMood => (urgent > 0 ? 'needs' : running > 0 ? 'working' : 'idle')

/** The frame of a cell pack for step `tick` of a mood (the pane steps twice a second). Resting is slower than working. */
export const frameAt = (pack: CellPack, mood: BuddyMood, tick: number): BuddyFrame => {
  const frames = pack.moods[mood]
  const every = mood === 'idle' ? 2 : 1

  return frames[Math.floor(Math.max(0, tick) / every) % frames.length]
}

// --------------------------------------------------------------------------------------------------------- scene
/** One terminal cell: a glyph, its colour and the colour behind it (null: the terminal's own). */
export type BuddyCell = { ch: string; fg: string | null; bg: string | null }

// a small deterministic hash, so a scene is a pure function of the time
const rand = (a: number, b: number, c = 0) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16

  return (h >>> 0) / 4294967296
}

const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
const mix = (c: string, to: string, f: number) => {
  const a = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
  const b = [1, 3, 5].map(i => parseInt(to.slice(i, i + 2), 16))

  return `#${a.map((v, i) => hex2(v + (b[i] - v) * f)).join('')}`
}

/**
 * Which rows of a sprite to keep so it fits `h` rows: the rows most like their neighbours go first (a body row
 * repeated, never the eyes or the ears), decided on one frame so every frame of a mood loses the same rows.
 */
const keepRows = (rows: string[], h: number): number[] => {
  const keep = rows.map((_, i) => i)
  const diff = (a: string, b: string) => {
    let n = 0
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? '.') !== (b[i] ?? '.')) n++
    return n
  }
  while (keep.length > Math.max(1, h)) {
    let best = 1
    let score = Infinity
    for (let k = 1; k < keep.length - 1; k++) {
      const v = Math.min(diff(rows[keep[k]], rows[keep[k - 1]]), diff(rows[keep[k]], rows[keep[k + 1]]))
      if (v < score) {
        score = v
        best = k
      }
    }
    keep.splice(keep.length > 2 ? best : keep.length - 1, 1)
  }

  return keep
}

const FIRE = ['#fff6c8', '#ffe066', '#ffb020', '#ff7a1a', '#e8401a', '#b02810']
const SPARK = ['#ffffff', '#fff27a', '#ffd400']
const WATER = ['#d8f2ff', '#78c8ff', '#3890e8']
const SHADOW = ['#2a1440', '#5a2c90', '#9058e0', '#e0a8ff']
const LEAF = ['#88e070', '#40b048', '#2a7a30']
const DUST = ['#8a8478', '#5e5a52']
const ZZZ = '#9fb0d8'

/**
 * The buddy's scene at time `t` (ms), drawn for a slot of `cols` x `rows` cells: rows of cells, top first.
 * The same time always draws the same scene.
 */
export function drawScene(pack: SpritePack, mood: BuddyMood, t: number, cols: number, rows: number): BuddyCell[][] {
  const W = Math.max(1, cols)
  const H = Math.max(2, rows * 2)
  const px: (string | null)[] = new Array(W * H).fill(null)
  const glyphs = new Map<number, BuddyCell>()
  const put = (x: number, y: number, c: string | null) => {
    x = Math.round(x)
    y = Math.round(y)
    if (c && x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c
  }
  const free = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && px[Math.round(y) * W + Math.round(x)] === null

  const m = pack.moods[mood]
  const step = Math.floor(Math.max(0, t) / m.ms)
  const keep = m.frames[0].length > H ? keepRows(m.frames[0], H) : null
  const frame = m.frames[step % m.frames.length]
  const sprite = keep ? keep.map(i => frame[i] ?? '') : frame
  const h = sprite.length
  const w = Math.max(...sprite.map(r => r.length))
  const span = Math.max(0, W - w)
  const room = H - h
  const secs = Math.max(0, t) / 1000

  // ---- where the sprite is, and which way it faces
  let x = Math.min(1, span)
  let y = room
  let flip = false
  const pingPong = (speed: number) => {
    if (span === 0) return
    const d = (secs * speed) % (2 * span)
    x = Math.floor(d < span ? d : 2 * span - d)
    flip = d >= span
  }
  switch (m.motion) {
    case 'walk':
      pingPong(4)
      break
    case 'run':
      pingPong(9)
      if (room > 0 && step % 2 === 1) y = room - 1
      break
    case 'fly':
      pingPong(6)
      y = room > 0 ? Math.max(0, room - 1 - (Math.sin(secs * 4) > 0 ? 1 : 0)) : Math.sin(secs * 4) > 0 ? 0 : 1
      break
    case 'float':
      x = clamp(Math.round(span * 0.25 + Math.sin(secs * 0.8) * Math.min(4, span / 4)), 0, span)
      y = room > 0 ? Math.round((room - 1) / 2 + Math.sin(secs * 2.2) * Math.max(1, room / 2)) : Math.sin(secs * 2.2) > 0.3 ? 1 : 0
      break
    case 'hop': {
      const hop = [0, 1, 2, 3, 3, 2, 1, 0, 0, 0][Math.floor(secs * 10) % 10]
      x = Math.min(2, span)
      if (room > 0) y = room - Math.min(room, hop)
      else x += hop > 1 ? 1 : 0
      break
    }
    case 'shake':
      x = Math.min(1, span) + (Math.floor(secs * 12) % 2)
      break
    default:
      break
  }

  // ---- the sprite (thunder makes it flash)
  const strike = Math.floor(secs * 6) % 4 // thunder: a bolt on steps 0 and 1, the body flashing on 0
  const flash = m.fx === 'thunder' && strike === 0
  const dim = m.fx === 'zzz'
  for (let r = 0; r < h; r++) {
    const row = sprite[r]
    for (let c = 0; c < row.length; c++) {
      const k = row[c]
      if (k === '.') continue
      let col = pack.palette[k]
      if (flash) col = mix(col, '#ffffff', 0.3)
      else if (dim) col = mix(col, '#000000', 0.1)
      put(flip ? x + (w - 1 - c) : x + c, y + r, col)
    }
  }
  const body = new Set(px.map((c, i) => (c ? i : -1)).filter(i => i >= 0))

  // ---- the effect
  const dir = flip ? -1 : 1
  const mx = flip ? x + (w - 1 - clamp(pack.mouth[0], 0, w - 1)) : x + clamp(pack.mouth[0], 0, w - 1)
  const my = y + clamp(keep ? keep.filter(i => i < pack.mouth[1]).length : pack.mouth[1], 0, h - 1)
  const tick = Math.floor(secs * 10) // effects step ten times a second
  switch (m.fx) {
    case 'fire': {
      // breathe: a stream that grows from the mouth to the edge of the slot, flickers, then stops for a breath
      const cycle = secs % 2.6
      const reach = cycle < 0.3 ? 0 : Math.min(W, Math.floor((cycle - 0.3) * 30))
      const fade = cycle > 2.2 ? Math.floor((cycle - 2.2) * 40) : 0
      for (let d = 1 + fade; d <= reach; d++) {
        const fx = mx + dir * d
        const wob = Math.round(Math.sin(d * 0.9 - secs * 14) * 0.6)
        const r = Math.min(2, Math.floor(d / 4) + (rand(d, tick) > 0.6 ? 1 : 0))
        for (let o = -r; o <= r; o++) {
          if (d > 6 && rand(d, o, tick) < 0.18) continue
          const heat = clamp(Math.floor(d / 3) + Math.abs(o) + (rand(o, d, tick + 7) > 0.7 ? 1 : 0), 0, FIRE.length - 1)
          if (free(fx, my + o + wob)) put(fx, my + o + wob, FIRE[heat])
        }
      }
      break
    }
    case 'sparks':
    case 'thunder': {
      // little zigzags crackling around the body, and for thunder a bolt from the top of the slot
      const n = m.fx === 'thunder' ? 4 : 2
      for (let i = 0; i < n; i++) {
        const sx = Math.round(x - 3 + rand(i, tick) * (w + 6))
        const sy = Math.floor(rand(tick, i, 3) * (H - 2))
        const c = SPARK[Math.floor(rand(i, tick, 9) * SPARK.length)]
        for (const [dx, dy] of [[0, 0], [1, 1], [0, 2]]) if (free(sx + dx, sy + dy)) put(sx + dx, sy + dy, c)
      }
      if (m.fx === 'thunder' && strike < 2) {
        // a zigzag bolt, top of the slot to the ground, on one side of the body or the other
        const side = Math.floor(secs * 1.5) % 2 === 0 || x < 5 ? 1 : -1 // never over the body
        const bx = side > 0 ? x + w + 2 : x - 5
        const zig = [2, 1, 0, 1, 2, 3, 2, 1, 2, 3, 2, 1, 0, 1, 2, 3]
        for (let by = 0; by < H; by++) {
          const zx = bx + zig[by % zig.length]
          put(zx, by, SPARK[0])
          put(zx + 1, by, SPARK[2])
        }
      }
      break
    }
    case 'shadow': {
      // a shadow ball: grows in front of the mouth, then flies off to the edge
      const cycle = secs % 2.4
      const travel = cycle < 0.8 ? 0 : Math.floor((cycle - 0.8) * 22)
      const r = cycle < 0.3 ? 1 : 2 // a dot, then a round ball (radius 2 plus a half: no square corners)
      const cx = mx + dir * (2 + r + travel)
      const cy = clamp(my, r, H - 1 - r)
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          const d = Math.hypot(ox, oy)
          if (d > r + 0.5) continue
          const ring = d > r - 0.6
          const c = ring ? (rand(ox, oy, tick) > 0.6 ? SHADOW[3] : SHADOW[2]) : d < 0.5 ? SHADOW[0] : SHADOW[1]
          if (free(cx + ox, cy + oy) || !body.has(Math.round(cy + oy) * W + Math.round(cx + ox))) put(cx + ox, cy + oy, c)
        }
      }
      // wisps left behind the floating body
      for (let i = 0; i < 3; i++) {
        const age = (tick + i * 3) % 9
        const wx = x - dir * (1 + age) + (flip ? w : 0)
        const wy = y + h - 2 - Math.floor(age / 3) - Math.floor(rand(i, Math.floor(tick / 9)) * 3)
        if (free(wx, wy)) put(wx, wy, age < 4 ? SHADOW[2] : SHADOW[1])
      }
      break
    }
    case 'water': {
      // a water gun: drops in an arc from the mouth
      for (let i = 0; i < 7; i++) {
        const ph = (secs * 14 + i * 2.6) % 18
        const dx = 1 + ph * 1.2
        const dy = -0.6 * ph + 0.06 * ph * ph
        // each drop two pixels long, its leading pixel the lighter
        if (free(mx + dir * dx, my + dy)) put(mx + dir * dx, my + dy, WATER[i % 2 ? 0 : 1])
        if (free(mx + dir * (dx - 1), my + dy)) put(mx + dir * (dx - 1), my + dy, WATER[i % 2 ? 1 : 2])
      }
      break
    }
    case 'leaves': {
      for (let i = 0; i < 4; i++) {
        const a = secs * 2.5 + (i * Math.PI) / 2
        const lx = x + w / 2 + Math.cos(a) * (w / 2 + 2)
        const ly = y + h / 2 + Math.sin(a) * (h / 2)
        const c = LEAF[i % LEAF.length]
        if (free(lx, ly)) put(lx, ly, c)
        if (free(lx + 1, ly)) put(lx + 1, ly, LEAF[(i + 1) % LEAF.length])
      }
      break
    }
    case 'dust': {
      for (let i = 0; i < 3; i++) {
        const age = (tick + i * 2) % 6
        const dx = flip ? x + w + age : x - 1 - age
        if (free(dx, H - 1 - (age > 2 ? 1 : 0))) put(dx, H - 1 - (age > 2 ? 1 : 0), DUST[age > 2 ? 1 : 0])
      }
      break
    }
    case 'zzz': {
      // z's rise from above the head, one more each beat, then start over
      const n = 1 + (Math.floor(secs / 0.9) % 3)
      const zx = Math.floor(flip ? x - 1 : x + w)
      for (let i = 0; i < n; i++) {
        const cx = zx + (flip ? -i : i)
        const cy = Math.max(0, Math.floor((y + 1) / 2) + 1 - i)
        if (cx >= 0 && cx < W) glyphs.set(cy * W + cx, { ch: i === 2 ? 'Z' : 'z', fg: ZZZ, bg: null })
      }
      break
    }
    default:
      break
  }

  // ---- half blocks: two pixels a cell, the top one in the glyph's colour
  const out: BuddyCell[][] = []
  for (let cy = 0; cy < rows; cy++) {
    const line: BuddyCell[] = []
    for (let cx = 0; cx < W; cx++) {
      const g = glyphs.get(cy * W + cx)
      if (g) {
        line.push(g)
        continue
      }
      const top = px[cy * 2 * W + cx]
      const bot = cy * 2 + 1 < H ? px[(cy * 2 + 1) * W + cx] : null
      if (top && bot) line.push(top === bot ? { ch: '█', fg: top, bg: null } : { ch: '▀', fg: top, bg: bot })
      else if (top) line.push({ ch: '▀', fg: top, bg: null })
      else if (bot) line.push({ ch: '▄', fg: bot, bg: null })
      else line.push({ ch: ' ', fg: null, bg: null })
    }
    out.push(line)
  }

  return out
}

/** Cells as text runs (one <Text> per run), the form every surface draws. Trailing blanks are dropped. */
export const toRuns = (cells: BuddyCell[][]): BuddyRun[][] =>
  cells.map(line => {
    const runs: BuddyRun[] = []
    let end = line.length
    while (end > 0 && line[end - 1].ch === ' ') end--
    for (const c of line.slice(0, end)) {
      const last = runs[runs.length - 1]
      if (last && last[1] === c.fg && last[2] === c.bg) last[0] += c.ch
      else runs.push([c.ch, c.fg, c.bg])
    }
    return runs
  })

/** Cells packed for a terminal `Raster`: base64 of little-endian u32 [codePoint, fg, bg] per cell, row-major. */
export const toRaster = (cells: BuddyCell[][]): string => {
  const DEFAULT = 0x01000000
  const col = (c: string | null) => (c ? parseInt(c.slice(1), 16) : DEFAULT)
  const words: number[] = []
  for (const line of cells) for (const c of line) words.push(c.ch.codePointAt(0) ?? 32, c.ch === ' ' ? DEFAULT : col(c.fg), col(c.bg))
  const bytes = new Uint8Array(new Uint32Array(words).buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])

  return btoa(bin)
}

/** What the pane shows for a pack: rows of runs for `cols` x `rows` cells at time `t` (cell packs step on `tick`). */
export const buddyRuns = (pack: BuddyPack, mood: BuddyMood, t: number, tick: number, cols: number, rows: number): BuddyRun[][] =>
  pack.kind === 'cells' ? frameAt(pack, mood, tick).rows : toRuns(drawScene(pack, mood, t, cols, rows))

let loaded: BuddyPack | null = null
export const setBuddy = (pack: BuddyPack | null) => {
  loaded = pack
}
export const getBuddy = () => loaded

/** What the pane last drew the buddy at, so a timer can repaint it in place between redraws. */
export type BuddyStage = { mood: BuddyMood; cols: number; rows: number }
let stage: BuddyStage | null = null
export const setStage = (s: BuddyStage | null) => {
  stage = s
}
export const getStage = () => stage
