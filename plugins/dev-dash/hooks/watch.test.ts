import { describe, expect, test } from 'claude-code/testing'

import {
  addWatch,
  checksOf,
  clearWatches,
  describeChange,
  isExpired,
  newWatch,
  parsePrRef,
  parseWatchArgs,
  pollable,
  readPr,
  stepWatch,
  WATCH_EXPIRY_MS,
  WATCHES_KEPT,
} from './watch'

const NOW = 1_800_000_000_000
const ref = (n: number, repo = 'o/r') => ({ repo, number: n })

describe('naming a pull request', () => {
  test('number, #number, owner/repo#number and URL', () => {
    expect(parsePrRef('42')).toEqual({ repo: '', number: 42 })
    expect(parsePrRef('#42')).toEqual({ repo: '', number: 42 })
    expect(parsePrRef('RanaRauff/claude-dev-dashboard#8')).toEqual({ repo: 'RanaRauff/claude-dev-dashboard', number: 8 })
    expect(parsePrRef('https://github.com/RanaRauff/claude-dev-dashboard/pull/11')).toEqual({ repo: 'RanaRauff/claude-dev-dashboard', number: 11 })
    expect(parsePrRef('https://github.com/o/r/pull/7/files')).toEqual({ repo: 'o/r', number: 7 })
  })

  test('anything else is not a pull request', () => {
    for (const s of ['', 'abc', 'pr', 'o/r', 'https://example.com/o/r/pull/1', '4x2', '-3']) expect(parsePrRef(s)).toBeNull()
  })
})

describe('reading a pull request', () => {
  test('checks: failing beats pending beats passing; none when there are no checks', () => {
    expect(checksOf([])).toBe('none')
    expect(checksOf(undefined)).toBe('none')
    expect(checksOf([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }])).toBe('passing')
    expect(checksOf([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending')
    expect(checksOf([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }])).toBe('failing')
    expect(checksOf([{ state: 'ERROR' }])).toBe('failing')
    expect(checksOf([{ status: 'COMPLETED', conclusion: 'CANCELLED' }])).toBe('failing')
    expect(checksOf([{ state: 'PENDING' }])).toBe('pending')
  })

  test('an open PR is a comparable value plus words', () => {
    const r = readPr({ state: 'OPEN', title: ' Keyboard nav ', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] })
    expect(r).toEqual({ value: 'OPEN|passing|review required', detail: 'open · CI passing · review required', title: 'Keyboard nav', done: false })
  })

  test('merged and closed are over; garbage is not a reading', () => {
    expect(readPr({ state: 'MERGED', reviewDecision: 'APPROVED', statusCheckRollup: [] })?.done).toBe(true)
    expect(readPr({ state: 'CLOSED' })?.detail).toBe('closed')
    expect(readPr({ state: 'WHAT' })).toBeNull()
    expect(readPr(null)).toBeNull()
    expect(readPr('x')).toBeNull()
  })

  test('says what changed', () => {
    expect(describeChange('OPEN|pending|none', 'OPEN|failing|none')).toBe('CI failing')
    expect(describeChange('OPEN|passing|none', 'OPEN|passing|approved')).toBe('approved')
    expect(describeChange('OPEN|pending|none', 'OPEN|passing|approved')).toBe('CI passing, approved')
    expect(describeChange('OPEN|passing|approved', 'OPEN|passing|changes requested')).toBe('changes requested')
    expect(describeChange('OPEN|passing|approved', 'OPEN|passing|none')).toBe('no review')
    expect(describeChange('OPEN|passing|approved', 'MERGED|passing|approved')).toBe('merged')
    expect(describeChange('OPEN|passing|approved', 'CLOSED|passing|approved')).toBe('closed')
    expect(describeChange('CLOSED|passing|approved', 'OPEN|passing|approved')).toBe('reopened')
  })
})

describe('a watch over time', () => {
  const look = (value: string, title = 'T') => ({ value, detail: value, title, done: value.startsWith('MERGED') })

  test('the first look is a baseline and does not fire', () => {
    const w = stepWatch(newWatch(ref(6), NOW), look('OPEN|pending|none'), NOW + 1000)
    expect(w.value).toBe('OPEN|pending|none')
    expect(w.firedAt).toBe(0)
    expect(w.fired).toBe('')
    expect(w.checkedAt).toBe(NOW + 1000)
    expect(w.title).toBe('T')
  })

  test('the same value stays quiet; a different one fires and stays fired', () => {
    const base = stepWatch(newWatch(ref(6), NOW), look('OPEN|pending|none'), NOW)
    const same = stepWatch(base, look('OPEN|pending|none'), NOW + 60_000)
    expect(same.firedAt).toBe(0)
    expect(same.checkedAt).toBe(NOW + 60_000)
    const fired = stepWatch(same, look('OPEN|failing|none'), NOW + 120_000)
    expect(fired.fired).toBe('CI failing')
    expect(fired.firedAt).toBe(NOW + 120_000)
    const later = stepWatch(fired, look('OPEN|failing|none'), NOW + 180_000)
    expect(later.fired).toBe('CI failing')
    expect(later.firedAt).toBe(NOW + 120_000)
  })

  test('a merged PR is done and no longer polled; a fire pushes the expiry out', () => {
    const base = stepWatch(newWatch(ref(6), NOW), look('OPEN|passing|approved'), NOW)
    const merged = stepWatch(base, look('MERGED|passing|approved'), NOW + WATCH_EXPIRY_MS - 1000)
    expect(merged.done).toBe(true)
    expect(merged.fired).toBe('merged')
    expect(merged.expiresAt).toBe(NOW + WATCH_EXPIRY_MS - 1000 + WATCH_EXPIRY_MS)
    expect(pollable([merged, base], NOW + 1000).map(w => w.number)).toEqual([6])
  })

  test('a watch expires after a day', () => {
    const w = newWatch(ref(6), NOW)
    expect(isExpired(w, NOW + WATCH_EXPIRY_MS - 1)).toBe(false)
    expect(isExpired(w, NOW + WATCH_EXPIRY_MS)).toBe(true)
    expect(pollable([w], NOW + WATCH_EXPIRY_MS)).toEqual([])
  })
})

describe('the list', () => {
  test('a repeat is kept as it was; case in the repo name does not make a second one', () => {
    const a = addWatch([], ref(6), NOW)
    expect(a.list.length).toBe(1)
    const b = addWatch(a.list, ref(6, 'O/R'), NOW + 5000)
    expect(b.list.length).toBe(1)
    expect(b.added?.addedAt).toBe(NOW)
  })

  test('a full list refuses and says how to make room', () => {
    let list = [] as ReturnType<typeof addWatch>['list']
    for (let i = 1; i <= WATCHES_KEPT; i++) list = addWatch(list, ref(i), NOW).list
    const over = addWatch(list, ref(99), NOW)
    expect(over.list.length).toBe(WATCHES_KEPT)
    expect(over.added).toBeNull()
    expect(over.error).toContain('/dash-watch clear')
  })

  test('expired watches drop out when adding', () => {
    const old = addWatch([], ref(1), NOW).list
    const next = addWatch(old, ref(2), NOW + WATCH_EXPIRY_MS + 1)
    expect(next.list.map(w => w.number)).toEqual([2])
  })

  test('clear by position or all; a wrong number clears nothing', () => {
    const list = [1, 2, 3].reduce((l, n) => addWatch(l, ref(n), NOW).list, [] as ReturnType<typeof addWatch>['list'])
    expect(clearWatches(list, '2').list.map(w => w.number)).toEqual([1, 3])
    expect(clearWatches(list, '2').removed).toBe(1)
    expect(clearWatches(list, 'ALL')).toEqual({ list: [], removed: 3 })
    expect(clearWatches(list, '0').removed).toBe(0)
    expect(clearWatches(list, '9').removed).toBe(0)
    expect(clearWatches(list, 'x').removed).toBe(0)
  })
})

describe('the command', () => {
  test('add, list, clear and help', () => {
    expect(parseWatchArgs('pr 42')).toEqual({ cmd: 'add', ref: { repo: '', number: 42 } })
    expect(parseWatchArgs('42')).toEqual({ cmd: 'add', ref: { repo: '', number: 42 } })
    expect(parseWatchArgs('https://github.com/o/r/pull/9')).toEqual({ cmd: 'add', ref: { repo: 'o/r', number: 9 } })
    expect(parseWatchArgs('PR o/r#3')).toEqual({ cmd: 'add', ref: { repo: 'o/r', number: 3 } })
    expect(parseWatchArgs('')).toEqual({ cmd: 'list' })
    expect(parseWatchArgs(' list ')).toEqual({ cmd: 'list' })
    expect(parseWatchArgs('clear 2')).toEqual({ cmd: 'clear', which: '2' })
    expect(parseWatchArgs('clear all')).toEqual({ cmd: 'clear', which: 'all' })
    expect(parseWatchArgs('clear').cmd).toBe('help')
    expect(parseWatchArgs('pr').cmd).toBe('help')
    expect(parseWatchArgs('jenkins job x').cmd).toBe('help')
  })
})
