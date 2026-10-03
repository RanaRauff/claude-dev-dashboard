import { describe, expect, test } from 'claude-code/testing'

import {
  addWatch,
  checksOf,
  clearWatches,
  describe as describeKind,
  describeChange,
  describeIssueChange,
  describeRunChange,
  isExpired,
  newWatch,
  parseIssueRef,
  parsePrRef,
  parseRunRef,
  parseWatchArgs,
  pollable,
  readIssue,
  readPr,
  readRun,
  stepWatch,
  watchId,
  watchName,
  WATCH_EXPIRY_MS,
  WATCHES_KEPT,
} from './watch'

const NOW = 1_800_000_000_000
const ref = (n: number, repo = 'o/r') => ({ kind: 'pr' as const, repo, number: n })

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

  const PASS = [{ status: 'COMPLETED', conclusion: 'SUCCESS' }]

  test('an open PR is a comparable value plus words: a review still outstanding is not ready', () => {
    const r = readPr({ state: 'OPEN', title: ' Keyboard nav ', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: PASS })
    expect(r).toEqual({ value: 'OPEN|passing|review required|open|', detail: 'open · CI passing · not approved', title: 'Keyboard nav', done: false })
  })

  test('approved, not a draft, CI passing and no conflicts is ready to merge', () => {
    const r = readPr({ state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: PASS })
    expect(r?.detail).toBe('ready to merge · CI passing · approved')
    expect(r?.value).toBe('OPEN|passing|approved|ready|')
  })

  test('a draft says draft however green it is', () => {
    const r = readPr({ state: 'OPEN', isDraft: true, reviewDecision: 'APPROVED', statusCheckRollup: PASS })
    expect(r?.detail).toBe('draft · CI passing · approved')
    expect(r?.value).toBe('OPEN|passing|approved|draft|')
  })

  test('failing or running CI, requested changes and merge conflicts each keep it from being ready', () => {
    expect(readPr({ state: 'OPEN', statusCheckRollup: [{ state: 'FAILURE' }] })?.detail).toBe('open · CI failing · not approved')
    expect(readPr({ state: 'OPEN', reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'IN_PROGRESS' }] })?.detail).toBe('open · CI running · approved')
    expect(readPr({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: PASS })?.detail).toBe('open · CI passing · changes requested')
    const conflict = readPr({ state: 'OPEN', mergeable: 'CONFLICTING', reviewDecision: 'APPROVED', statusCheckRollup: PASS })
    expect(conflict?.detail).toBe('open · merge conflicts · CI passing · approved')
    expect(conflict?.value).toBe('OPEN|passing|approved|open|conflict')
  })

  test('a PR that needs no review can be ready while not approved; no checks is said plainly', () => {
    expect(readPr({ state: 'OPEN', reviewDecision: '', statusCheckRollup: PASS })?.detail).toBe('ready to merge · CI passing · not approved')
    expect(readPr({ state: 'OPEN', reviewDecision: null, statusCheckRollup: [] })?.detail).toBe('ready to merge · no CI checks · not approved')
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
    expect(describeChange('OPEN|passing|approved', 'OPEN|passing|none')).toBe('not approved')
    expect(describeChange('OPEN|passing|approved', 'MERGED|passing|approved')).toBe('merged')
    expect(describeChange('OPEN|passing|approved', 'CLOSED|passing|approved')).toBe('closed')
    expect(describeChange('CLOSED|passing|approved', 'OPEN|passing|approved')).toBe('reopened')
  })

  test('says when it became ready to merge, left draft, went back to draft or hit conflicts', () => {
    expect(describeChange('OPEN|passing|approved|ready|', 'OPEN|failing|approved|open|')).toBe('CI failing')
    expect(describeChange('OPEN|pending|none|open|', 'OPEN|passing|approved|ready|')).toBe('CI passing, approved, ready to merge')
    expect(describeChange('OPEN|passing|approved|draft|', 'OPEN|passing|approved|ready|')).toBe('ready to merge')
    expect(describeChange('OPEN|passing|approved|draft|', 'OPEN|passing|approved|open|')).toBe('ready for review')
    expect(describeChange('OPEN|passing|approved|ready|', 'OPEN|passing|approved|draft|')).toBe('back to draft')
    expect(describeChange('OPEN|passing|approved|ready|', 'OPEN|passing|approved|open|conflict')).toBe('merge conflicts')
    expect(describeChange('OPEN|passing|approved|open|conflict', 'OPEN|passing|approved|ready|')).toBe('conflicts resolved, ready to merge')
  })

  test('a value saved before stages existed still compares', () => {
    expect(describeChange('OPEN|passing|none', 'OPEN|passing|none|ready|')).toBe('changed')
    expect(describeChange('OPEN|pending|none', 'OPEN|passing|none|ready|')).toBe('CI passing')
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
  test('pull requests: with the verb, bare, or as a URL', () => {
    expect(parseWatchArgs('pr 42')).toEqual({ cmd: 'add', spec: { kind: 'pr', repo: '', number: 42 } })
    expect(parseWatchArgs('42')).toEqual({ cmd: 'add', spec: { kind: 'pr', repo: '', number: 42 } })
    expect(parseWatchArgs('https://github.com/o/r/pull/9')).toEqual({ cmd: 'add', spec: { kind: 'pr', repo: 'o/r', number: 9 } })
    expect(parseWatchArgs('PR o/r#3')).toEqual({ cmd: 'add', spec: { kind: 'pr', repo: 'o/r', number: 3 } })
  })

  test('issues and runs: with the verb, or as a URL that says what it is', () => {
    expect(parseWatchArgs('issue 12')).toEqual({ cmd: 'add', spec: { kind: 'issue', repo: '', number: 12 } })
    expect(parseWatchArgs('issue o/r#5')).toEqual({ cmd: 'add', spec: { kind: 'issue', repo: 'o/r', number: 5 } })
    expect(parseWatchArgs('issue https://github.com/o/r/issues/9')).toEqual({ cmd: 'add', spec: { kind: 'issue', repo: 'o/r', number: 9 } })
    expect(parseWatchArgs('https://github.com/o/r/issues/9')).toEqual({ cmd: 'add', spec: { kind: 'issue', repo: 'o/r', number: 9 } })
    expect(parseWatchArgs('run 99')).toEqual({ cmd: 'add', spec: { kind: 'run', repo: '', number: 99 } })
    expect(parseWatchArgs('run https://github.com/o/r/actions/runs/123456789')).toEqual({ cmd: 'add', spec: { kind: 'run', repo: 'o/r', number: 123456789 } })
    expect(parseWatchArgs('https://github.com/o/r/actions/runs/55')).toEqual({ cmd: 'add', spec: { kind: 'run', repo: 'o/r', number: 55 } })
  })

  test('list, clear and help', () => {
    expect(parseWatchArgs('')).toEqual({ cmd: 'list' })
    expect(parseWatchArgs(' list ')).toEqual({ cmd: 'list' })
    expect(parseWatchArgs('clear 2')).toEqual({ cmd: 'clear', which: '2' })
    expect(parseWatchArgs('clear all')).toEqual({ cmd: 'clear', which: 'all' })
    expect(parseWatchArgs('clear').cmd).toBe('help')
    expect(parseWatchArgs('pr').cmd).toBe('help')
    expect(parseWatchArgs('issue abc').cmd).toBe('help')
    expect(parseWatchArgs('run').cmd).toBe('help')
    expect(parseWatchArgs('jenkins job x').cmd).toBe('help')
  })
})

describe('issues', () => {
  test('naming one: a number, owner/repo#number or an issues URL, not a pull request URL', () => {
    expect(parseIssueRef('12')).toEqual({ repo: '', number: 12 })
    expect(parseIssueRef('o/r#5')).toEqual({ repo: 'o/r', number: 5 })
    expect(parseIssueRef('https://github.com/o/r/issues/9')).toEqual({ repo: 'o/r', number: 9 })
    expect(parseIssueRef('https://github.com/o/r/pull/9')).toBeNull()
  })

  test('open: comments, who it is assigned to', () => {
    const r = readIssue({ state: 'OPEN', title: ' Crash on start ', comments: [{}, {}], labels: [{ name: 'ui' }, { name: 'bug' }], assignees: [{ login: 'ana' }] })
    expect(r?.value).toBe('OPEN|2|bug,ui|ana')
    expect(r?.detail).toBe('open · 2 comments · assigned to ana')
    expect(r?.title).toBe('Crash on start')
    expect(r?.done).toBe(false)
  })

  test('unassigned and uncommented say so', () => {
    expect(readIssue({ state: 'OPEN', comments: [{}] })?.detail).toBe('open · 1 comment · unassigned')
    expect(readIssue({ state: 'OPEN' })?.detail).toBe('open · 0 comments · unassigned')
  })

  test('closed is over, and says when it was not planned; garbage is not a reading', () => {
    expect(readIssue({ state: 'CLOSED', stateReason: 'COMPLETED' })?.detail).toBe('closed')
    expect(readIssue({ state: 'CLOSED', stateReason: 'NOT_PLANNED' })?.detail).toBe('not planned')
    expect(readIssue({ state: 'CLOSED' })?.done).toBe(true)
    expect(readIssue({ state: 'MERGED' })).toBeNull()
    expect(readIssue(null)).toBeNull()
  })

  test('says what changed', () => {
    expect(describeIssueChange('OPEN|2|bug|ana', 'OPEN|3|bug|ana')).toBe('new comment')
    expect(describeIssueChange('OPEN|2|bug|ana', 'OPEN|4|bug|ana')).toBe('2 new comments')
    expect(describeIssueChange('OPEN|2|bug|', 'OPEN|2|bug|ana')).toBe('assigned')
    expect(describeIssueChange('OPEN|2|bug|ana', 'OPEN|2|bug|')).toBe('unassigned')
    expect(describeIssueChange('OPEN|2|bug|ana', 'OPEN|2|bug,ui|ana')).toBe('labels changed')
    expect(describeIssueChange('OPEN|2|bug|ana', 'CLOSED|2|bug|ana')).toBe('closed')
    expect(describeIssueChange('CLOSED|2|bug|ana', 'OPEN|2|bug|ana')).toBe('reopened')
  })
})

describe('Actions runs', () => {
  test('naming one: a run id or an actions/runs URL', () => {
    expect(parseRunRef('99')).toEqual({ repo: '', number: 99 })
    expect(parseRunRef('https://github.com/o/r/actions/runs/123456789')).toEqual({ repo: 'o/r', number: 123456789 })
    expect(parseRunRef('https://github.com/o/r/issues/9')).toBeNull()
  })

  test('queued, running, passed, failed, cancelled', () => {
    const run = (status: string, conclusion = '') => readRun({ status, conclusion, workflowName: 'CI', headBranch: 'main' })
    expect(run('queued')?.detail).toBe('queued')
    expect(run('in_progress')?.detail).toBe('running')
    expect(run('in_progress')?.done).toBe(false)
    expect(run('completed', 'success')?.detail).toBe('passed')
    expect(run('completed', 'success')?.done).toBe(true)
    expect(run('completed', 'failure')?.detail).toBe('failed')
    expect(run('completed', 'cancelled')?.detail).toBe('cancelled')
    expect(run('completed', 'success')?.title).toBe('CI · main')
  })

  test('not a run, and what changed', () => {
    expect(readRun({})).toBeNull()
    expect(readRun(null)).toBeNull()
    expect(describeRunChange('in_progress|', 'completed|failure')).toBe('failed')
    expect(describeRunChange('in_progress|', 'completed|success')).toBe('passed')
  })
})

describe('one list for every kind', () => {
  test('each kind describes its own change', () => {
    expect(describeKind('pr', 'OPEN|pending|none', 'OPEN|failing|none')).toBe('CI failing')
    expect(describeKind('issue', 'OPEN|1||', 'OPEN|2||')).toBe('new comment')
    expect(describeKind('run', 'in_progress|', 'completed|success')).toBe('passed')
  })

  test('a watch of each kind fires on its own kind of change', () => {
    const look = (value: string, detail: string) => ({ value, detail, title: 'T', done: false })
    const issue = stepWatch(stepWatch(newWatch({ kind: 'issue', repo: 'o/r', number: 4 }, NOW), look('OPEN|1||', 'open'), NOW), look('OPEN|2||', 'open'), NOW + 60_000)
    expect(issue.fired).toBe('new comment')
    const run = stepWatch(stepWatch(newWatch({ kind: 'run', repo: 'o/r', number: 99 }, NOW), look('in_progress|', 'running'), NOW), look('completed|failure', 'failed'), NOW + 60_000)
    expect(run.fired).toBe('failed')
  })

  test('the same number as a PR, an issue and a run are three watches', () => {
    let list = addWatch([], { kind: 'pr', repo: 'o/r', number: 6 }, NOW).list
    list = addWatch(list, { kind: 'issue', repo: 'o/r', number: 6 }, NOW).list
    list = addWatch(list, { kind: 'run', repo: 'o/r', number: 6 }, NOW).list
    expect(list.map(w => w.id)).toEqual(['pr:o/r#6', 'issue:o/r#6', 'run:o/r#6'])
    expect(watchId({ kind: 'issue', repo: 'O/R', number: 6 })).toBe('issue:o/r#6')
  })

  test('what a watch is called on screen', () => {
    expect(watchName({ kind: 'pr', number: 11 })).toBe('PR #11')
    expect(watchName({ kind: 'issue', number: 4 })).toBe('Issue #4')
    expect(watchName({ kind: 'run', number: 123456 })).toBe('Run #123456')
  })
})
