import { describe, expect, test } from 'claude-code/testing'

import { addSource, countLines, isPlanLive, parseNumstat, planOf, shortUrl, sourceOf, totals } from './progress'

const NOW = 1_800_000_000_000

describe('plan', () => {
  test('counts completed todos and names the one in progress', () => {
    const plan = planOf({
      todos: [
        { content: 'Read code', status: 'completed', activeForm: 'Reading code' },
        { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
        { content: 'Ship', status: 'pending', activeForm: 'Shipping' },
      ],
    })
    expect(plan).toEqual({ done: 1, total: 3, current: 'Writing tests' })
  })

  test('falls back to the next pending todo, then to nothing when all are done', () => {
    expect(planOf({ todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'pending' }] })?.current).toBe('B')
    expect(planOf({ todos: [{ content: 'A', status: 'completed' }] })).toEqual({ done: 1, total: 1, current: '' })
  })

  test('no todos, no plan', () => {
    expect(planOf({})).toBeNull()
    expect(planOf({ todos: [] })).toBeNull()
    expect(planOf({ todos: 'nope' })).toBeNull()
  })

  test('a finished plan lingers for ten minutes, an unfinished one stays', () => {
    const plan = { done: 2, total: 2, current: '' }
    expect(isPlanLive(plan, NOW, NOW - 60_000)).toBe(true)
    expect(isPlanLive(plan, NOW, NOW - 11 * 60_000)).toBe(false)
    expect(isPlanLive({ done: 1, total: 2, current: 'x' }, NOW, NOW - 3_600_000)).toBe(true)
    expect(isPlanLive(null, NOW, NOW)).toBe(false)
  })
})

describe('sources', () => {
  test('reads WebFetch urls and WebSearch queries, ignores other tools', () => {
    expect(sourceOf('WebFetch', { url: 'https://example.com/a' }, NOW)).toEqual({ at: NOW, kind: 'fetch', label: 'https://example.com/a' })
    expect(sourceOf('WebSearch', { query: 'claude code mods' }, NOW)).toEqual({ at: NOW, kind: 'search', label: 'claude code mods' })
    expect(sourceOf('Bash', { command: 'curl x' }, NOW)).toBeNull()
    expect(sourceOf('WebFetch', {}, NOW)).toBeNull()
  })

  test('newest first, a repeat moves to the front, capped', () => {
    const a = { at: 1, kind: 'fetch' as const, label: 'https://a.dev' }
    const b = { at: 2, kind: 'search' as const, label: 'b' }
    const list = addSource([a], b)
    expect(list.map(s => s.label)).toEqual(['b', 'https://a.dev'])
    expect(addSource(list, { ...a, at: 3 }).map(s => s.at)).toEqual([3, 2])
    expect(addSource(list, { at: 4, kind: 'search', label: 'c' }, 2).map(s => s.label)).toEqual(['c', 'b'])
  })

  test('shortens urls to host and path', () => {
    expect(shortUrl('https://www.example.com/docs/page/?x=1#top')).toBe('example.com/docs/page')
    expect(shortUrl('http://localhost:3000')).toBe('localhost:3000')
    expect(shortUrl('not a url')).toBe('not a url')
  })
})

describe('files changed this turn', () => {
  test('parses numstat, with binary files as zero', () => {
    const files = parseNumstat('12\t3\tsrc/a.ts\n-\t-\tlogo.png\n0\t5\tdocs/old.md\n')
    expect(files).toEqual([
      { path: 'src/a.ts', added: 12, removed: 3 },
      { path: 'logo.png', added: 0, removed: 0 },
      { path: 'docs/old.md', added: 0, removed: 5 },
    ])
    expect(totals(files)).toEqual({ added: 12, removed: 8 })
  })

  test('ignores lines that are not numstat', () => {
    expect(parseNumstat('warning: LF will be replaced by CRLF\n')).toEqual([])
    expect(parseNumstat('')).toEqual([])
  })

  test('counts lines of a new file, trailing newline or not', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('a\nb\n')).toBe(2)
    expect(countLines('a\r\nb\r\n')).toBe(2)
  })
})
