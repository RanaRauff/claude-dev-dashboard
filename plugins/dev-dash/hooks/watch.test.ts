import { describe, expect, test } from 'claude-code/testing'

import type { WatchSpec } from './watch'
import {
  addWatch,
  checksOf,
  clearWatches,
  describe as describeKind,
  describeChange,
  describeIssueChange,
  describeMailChange,
  describeRunChange,
  isExpired,
  mailQueryOf,
  newWatch,
  parsePrRef,
  parseWatchArgs,
  pollable,
  problemFor,
  readIssue,
  readMail,
  readPr,
  readRun,
  senderName,
  stepWatch,
  stuckWatch,
  unsupportedAdvice,
  watchId,
  WATCH_EXPIRY_MS,
  WATCHES_KEPT,
} from './watch'

const NOW = 1_800_000_000_000
const pr = (n: number, repo = 'o/r'): WatchSpec => ({ kind: 'pr', repo, number: n })

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

  test('an open PR is a comparable value plus words and marks: a review still outstanding is not ready', () => {
    const r = readPr({ state: 'OPEN', title: ' Keyboard nav ', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: PASS })
    expect(r?.value).toBe('OPEN|passing|review required|open|')
    expect(r?.detail).toBe('open · CI passing · not approved')
    expect(r?.title).toBe('Keyboard nav')
    expect(r?.done).toBe(false)
    expect(r?.tone).toBe('warn')
    expect(r?.chips.map(c => `${c.icon} ${c.text}`)).toEqual(['○ open', '● CI', '○ no approval'])
  })

  test('approved, not a draft, CI passing and no conflicts is ready to merge', () => {
    const r = readPr({ state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: PASS })
    expect(r?.detail).toBe('ready to merge · CI passing · approved')
    expect(r?.value).toBe('OPEN|passing|approved|ready|')
    expect(r?.tone).toBe('ok')
    expect(r?.chips.map(c => `${c.icon} ${c.text}`)).toEqual(['✔ ready', '● CI', '✔ approved'])
  })

  test('a draft says draft however green it is', () => {
    const r = readPr({ state: 'OPEN', isDraft: true, reviewDecision: 'APPROVED', statusCheckRollup: PASS })
    expect(r?.detail).toBe('draft · CI passing · approved')
    expect(r?.value).toBe('OPEN|passing|approved|draft|')
    expect(r?.tone).toBe('mute')
  })

  test('failing or running CI, requested changes and merge conflicts each keep it from being ready', () => {
    expect(readPr({ state: 'OPEN', statusCheckRollup: [{ state: 'FAILURE' }] })?.detail).toBe('open · CI failing · not approved')
    expect(readPr({ state: 'OPEN', reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'IN_PROGRESS' }] })?.detail).toBe('open · CI running · approved')
    expect(readPr({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: PASS })?.detail).toBe('open · CI passing · changes requested')
    const conflict = readPr({ state: 'OPEN', mergeable: 'CONFLICTING', reviewDecision: 'APPROVED', statusCheckRollup: PASS })
    expect(conflict?.detail).toBe('open · merge conflicts · CI passing · approved')
    expect(conflict?.value).toBe('OPEN|passing|approved|open|conflict')
    expect(conflict?.tone).toBe('bad')
    expect(conflict?.chips.map(c => c.icon)).toEqual(['○', '⚠', '●', '✔'])
  })

  test('a PR that needs no review can be ready while not approved; no checks is said plainly', () => {
    expect(readPr({ state: 'OPEN', reviewDecision: '', statusCheckRollup: PASS })?.detail).toBe('ready to merge · CI passing · not approved')
    expect(readPr({ state: 'OPEN', reviewDecision: null, statusCheckRollup: [] })?.detail).toBe('ready to merge · no CI checks · not approved')
  })

  test('merged and closed are over; garbage is not a reading', () => {
    expect(readPr({ state: 'MERGED', reviewDecision: 'APPROVED', statusCheckRollup: [] })?.done).toBe(true)
    expect(readPr({ state: 'MERGED' })?.chips.map(c => c.text)).toEqual(['merged'])
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

describe('reading an issue', () => {
  test('open: comments, who it is assigned to, labels', () => {
    const r = readIssue({ state: 'OPEN', title: ' Crash on start ', comments: [{}, {}], labels: [{ name: 'ui' }, { name: 'bug' }], assignees: [{ login: 'ana' }] })
    expect(r?.value).toBe('OPEN|2|bug,ui|ana')
    expect(r?.detail).toBe('open · 2 comments · assigned to ana')
    expect(r?.title).toBe('Crash on start')
    expect(r?.done).toBe(false)
    expect(r?.chips.map(c => `${c.icon} ${c.text}`)).toEqual(['○ open', '💬 2', '👤 ana', '🏷 bug, ui'])
  })

  test('unassigned and uncommented say so; many assignees and labels are folded', () => {
    expect(readIssue({ state: 'OPEN', comments: [{}] })?.detail).toBe('open · 1 comment · unassigned')
    expect(readIssue({ state: 'OPEN' })?.detail).toBe('open · 0 comments · unassigned')
    const many = readIssue({ state: 'OPEN', assignees: [{ login: 'a' }, { login: 'b' }, { login: 'c' }], labels: [{ name: 'x' }, { name: 'y' }, { name: 'z' }] })
    expect(many?.chips.map(c => c.text)).toEqual(['open', '0', 'a +2', 'x, y +1'])
  })

  test('closed is over, and says when it was not planned', () => {
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

describe('reading an Actions run', () => {
  test('queued, running, passed, failed, cancelled', () => {
    const run = (status: string, conclusion = '') => readRun({ status, conclusion, workflowName: 'CI', headBranch: 'main' })
    expect(run('queued')?.detail).toBe('queued')
    expect(run('in_progress')?.detail).toBe('running')
    expect(run('in_progress')?.done).toBe(false)
    expect(run('in_progress')?.tone).toBe('warn')
    expect(run('completed', 'success')?.detail).toBe('passed')
    expect(run('completed', 'success')?.done).toBe(true)
    expect(run('completed', 'failure')?.detail).toBe('failed')
    expect(run('completed', 'failure')?.tone).toBe('bad')
    expect(run('completed', 'cancelled')?.detail).toBe('cancelled')
    expect(run('completed', 'success')?.title).toBe('CI · main')
    expect(run('completed', 'failure')?.chips.map(c => `${c.icon} ${c.text}`)).toEqual(['✗ failed'])
  })

  test('not a run, and what changed', () => {
    expect(readRun({})).toBeNull()
    expect(readRun(null)).toBeNull()
    expect(describeRunChange('in_progress|', 'completed|failure')).toBe('failed')
    expect(describeRunChange('in_progress|', 'completed|success')).toBe('passed')
  })
})

describe('reading a mail thread', () => {
  const T = (iso: string) => Date.parse(iso)

  test('no match is the connector saying {} and is a baseline of nothing', () => {
    const r = readMail('{}', 'Invoice 1042')
    expect(r?.value).toBe('none')
    expect(r?.detail).toBe('no thread yet')
    expect(r?.title).toBe('Invoice 1042')
    expect(r?.done).toBe(false)
    expect(readMail('  ', 'x')).toBeNull()
  })

  test('counts messages and names who wrote last, and when', () => {
    const text = JSON.stringify({
      threads: [
        {
          id: 't1',
          messages: [
            { sender: 'Ada Lovelace <ada@x.org>', date: '2026-10-03T10:00:00Z' },
            { sender: 'Bob <bob@y.org>', date: '2026-10-03T11:00:00Z' },
          ],
        },
      ],
    })
    const r = readMail(text, 'Invoice')
    expect(r?.value).toBe(`1:2:${T('2026-10-03T11:00:00Z')}`)
    expect(r?.detail).toBe('2 messages · last from Bob')
    expect(r?.chips.map(c => `${c.icon} ${c.text}`)).toEqual(['✉ 2', '↩ Bob'])
    expect(r?.chips[1].at).toBe(T('2026-10-03T11:00:00Z'))
  })

  test('a thread without a message list counts as one; epoch seconds and a bare array are understood', () => {
    const r = readMail(JSON.stringify([{ id: 't', sender: 'ada@x.org', date: '1790000000' }]), 'S')
    expect(r?.value).toBe('1:1:1790000000000')
    expect(r?.detail).toBe('1 message · last from ada')
  })

  test('text that is not JSON still gives a value that changes when the text does', () => {
    const a = readMail('some results', 'S')
    const b = readMail('other results', 'S')
    expect(a?.value.startsWith('t:')).toBe(true)
    expect(a?.value).not.toBe(b?.value)
    expect(a?.detail).toBe('results changed')
  })

  test('says what changed', () => {
    expect(describeMailChange('none', '1:1:5')).toBe('thread found')
    expect(describeMailChange('1:1:5', 'none')).toBe('thread gone')
    expect(describeMailChange('1:1:5', '1:2:9')).toBe('new message')
    expect(describeMailChange('1:1:5', '1:3:9')).toBe('2 new messages')
    expect(describeMailChange('1:2:5', '2:3:9')).toBe('new thread')
    expect(describeMailChange('t:abc', 't:def')).toBe('changed')
  })

  test('the search uses the subject words only: no quotes, brackets or backslashes get through', () => {
    expect(mailQueryOf('Invoice 1042')).toBe('subject:(Invoice 1042)')
    expect(mailQueryOf('Invoice "1042" (urgent) \\ OR in:anywhere')).toBe('subject:(Invoice 1042 urgent OR in:anywhere)')
  })

  test('sender names', () => {
    expect(senderName('Ada Lovelace <ada@x.org>')).toBe('Ada Lovelace')
    expect(senderName('"Doe, Jane" <j@x.org>')).toBe('Doe, Jane')
    expect(senderName('ada@x.org')).toBe('ada')
    expect(senderName({ name: 'Bo' })).toBe('Bo')
    expect(senderName(undefined)).toBe('')
    expect(senderName('x'.repeat(40)).length).toBe(28)
  })
})

describe('a watch over time', () => {
  const look = (value: string, title = 'T') => ({ value, detail: value, title, done: value.startsWith('MERGED'), chips: [], tone: 'info' as const })

  test('the first look is a baseline and does not fire', () => {
    const w = stepWatch(newWatch(pr(6), NOW), look('OPEN|pending|none'), NOW + 1000)
    expect(w.value).toBe('OPEN|pending|none')
    expect(w.firedAt).toBe(0)
    expect(w.fired).toBe('')
    expect(w.checkedAt).toBe(NOW + 1000)
    expect(w.title).toBe('T')
  })

  test('the same value stays quiet; a different one fires and stays fired', () => {
    const base = stepWatch(newWatch(pr(6), NOW), look('OPEN|pending|none'), NOW)
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
    const base = stepWatch(newWatch(pr(6), NOW), look('OPEN|passing|approved'), NOW)
    const merged = stepWatch(base, look('MERGED|passing|approved'), NOW + WATCH_EXPIRY_MS - 1000)
    expect(merged.done).toBe(true)
    expect(merged.fired).toBe('merged')
    expect(merged.expiresAt).toBe(NOW + WATCH_EXPIRY_MS - 1000 + WATCH_EXPIRY_MS)
    expect(pollable([merged, base], NOW + 1000).map(w => w.number)).toEqual([6])
  })

  test('a watch expires after a day', () => {
    const w = newWatch(pr(6), NOW)
    expect(isExpired(w, NOW + WATCH_EXPIRY_MS - 1)).toBe(false)
    expect(isExpired(w, NOW + WATCH_EXPIRY_MS)).toBe(true)
    expect(pollable([w], NOW + WATCH_EXPIRY_MS)).toEqual([])
  })

  test('each kind describes its own change', () => {
    expect(describeKind('pr', 'OPEN|pending|none', 'OPEN|failing|none')).toBe('CI failing')
    expect(describeKind('issue', 'OPEN|1||', 'OPEN|2||')).toBe('new comment')
    expect(describeKind('run', 'in_progress|', 'completed|success')).toBe('passed')
    expect(describeKind('mail', '1:1:5', '1:2:9')).toBe('new message')
  })

  test('a mail watch takes a baseline of nothing, then fires when the thread appears and when it gets a reply', () => {
    const spec: WatchSpec = { kind: 'mail', query: ' Invoice 1042 ' }
    const w0 = newWatch(spec, NOW)
    expect(w0.id).toBe('mail:invoice 1042')
    expect(w0.query).toBe('Invoice 1042')
    expect(w0.repo).toBe('')
    expect(w0.number).toBe(0)
    const none = stepWatch(w0, readMail('{}', 'Invoice 1042') as NonNullable<ReturnType<typeof readMail>>, NOW)
    expect(none.firedAt).toBe(0)
    const found = stepWatch(none, readMail(JSON.stringify({ threads: [{ messages: [{ sender: 'a@x.org', date: '2026-10-03T10:00:00Z' }] }] }), 'Invoice 1042') as NonNullable<ReturnType<typeof readMail>>, NOW + 60_000)
    expect(found.fired).toBe('thread found')
    const reply = stepWatch(found, readMail(JSON.stringify({ threads: [{ messages: [{ sender: 'a@x.org', date: '2026-10-03T10:00:00Z' }, { sender: 'b@y.org', date: '2026-10-03T12:00:00Z' }] }] }), 'Invoice 1042') as NonNullable<ReturnType<typeof readMail>>, NOW + 120_000)
    expect(reply.fired).toBe('new message')
    expect(reply.chips?.map(c => c.icon)).toEqual(['✉', '↩'])
  })

  test('a look that failed keeps what was known and says why; the next good look clears it', () => {
    const base = stepWatch(newWatch(pr(6), NOW), look('OPEN|pending|none'), NOW)
    const stuck = stuckWatch(base, 'needs gh', NOW + 60_000)
    expect(stuck.value).toBe('OPEN|pending|none')
    expect(stuck.problem).toBe('needs gh')
    expect(stuck.checkedAt).toBe(NOW + 60_000)
    expect(stepWatch(stuck, look('OPEN|pending|none'), NOW + 120_000).problem).toBe('')
  })
})

describe('the list', () => {
  test('a repeat is kept as it was; case in the repo name does not make a second one', () => {
    const a = addWatch([], pr(6), NOW)
    expect(a.list.length).toBe(1)
    const b = addWatch(a.list, pr(6, 'O/R'), NOW + 5000)
    expect(b.list.length).toBe(1)
    expect(b.added?.addedAt).toBe(NOW)
  })

  test('the same number as a PR and as an issue are two watches; the same mail subject in any case is one', () => {
    const list = addWatch(addWatch([], pr(6), NOW).list, { kind: 'issue', repo: 'o/r', number: 6 }, NOW).list
    expect(list.map(w => w.id)).toEqual(['pr:o/r#6', 'issue:o/r#6'])
    const mail = addWatch(addWatch(list, { kind: 'mail', query: 'Invoice' }, NOW).list, { kind: 'mail', query: 'INVOICE' }, NOW)
    expect(mail.list.length).toBe(3)
    expect(watchId({ kind: 'mail', query: ' Invoice ' })).toBe('mail:invoice')
  })

  test('a full list refuses and says how to make room', () => {
    let list = [] as ReturnType<typeof addWatch>['list']
    for (let i = 1; i <= WATCHES_KEPT; i++) list = addWatch(list, pr(i), NOW).list
    const over = addWatch(list, pr(99), NOW)
    expect(over.list.length).toBe(WATCHES_KEPT)
    expect(over.added).toBeNull()
    expect(over.error).toContain('/dash-watch clear')
  })

  test('expired watches drop out when adding', () => {
    const old = addWatch([], pr(1), NOW).list
    const next = addWatch(old, pr(2), NOW + WATCH_EXPIRY_MS + 1)
    expect(next.list.map(w => w.number)).toEqual([2])
  })

  test('clear by position or all; a wrong number clears nothing', () => {
    const list = [1, 2, 3].reduce((l, n) => addWatch(l, pr(n), NOW).list, [] as ReturnType<typeof addWatch>['list'])
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

  test('issues and runs', () => {
    expect(parseWatchArgs('issue 12')).toEqual({ cmd: 'add', spec: { kind: 'issue', repo: '', number: 12 } })
    expect(parseWatchArgs('issue o/r#5')).toEqual({ cmd: 'add', spec: { kind: 'issue', repo: 'o/r', number: 5 } })
    expect(parseWatchArgs('issue https://github.com/o/r/issues/9')).toEqual({ cmd: 'add', spec: { kind: 'issue', repo: 'o/r', number: 9 } })
    expect(parseWatchArgs('https://github.com/o/r/issues/9')).toEqual({ cmd: 'add', spec: { kind: 'issue', repo: 'o/r', number: 9 } })
    expect(parseWatchArgs('run 99')).toEqual({ cmd: 'add', spec: { kind: 'run', repo: '', number: 99 } })
    expect(parseWatchArgs('run https://github.com/o/r/actions/runs/123456789')).toEqual({ cmd: 'add', spec: { kind: 'run', repo: 'o/r', number: 123456789 } })
    expect(parseWatchArgs('https://github.com/o/r/actions/runs/55')).toEqual({ cmd: 'add', spec: { kind: 'run', repo: 'o/r', number: 55 } })
  })

  test('mail by subject, with or without quotes', () => {
    expect(parseWatchArgs('mail Invoice 1042')).toEqual({ cmd: 'add', spec: { kind: 'mail', query: 'Invoice 1042' } })
    expect(parseWatchArgs('mail "Quarterly report"')).toEqual({ cmd: 'add', spec: { kind: 'mail', query: 'Quarterly report' } })
    expect(parseWatchArgs('gmail thread about the offer').cmd).toBe('add')
    expect(parseWatchArgs('mail').cmd).toBe('help')
    expect(parseWatchArgs('mail x').cmd).toBe('help')
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
  })
})

describe('watching something dev-dash cannot yet', () => {
  test('is told what to connect, by name', () => {
    const jenkins = parseWatchArgs('jenkins job nightly')
    expect(jenkins.cmd).toBe('unsupported')
    const advice = unsupportedAdvice('jenkins job nightly')
    expect(advice).toContain('Jenkins')
    expect(advice).toContain('CLI')
    expect(advice).toContain('MCP')
    expect(advice).toContain('Gmail threads')
    expect(unsupportedAdvice('tweets from @someone')).toContain('X / Twitter')
    expect(unsupportedAdvice('https://example.com/status')).toContain('web page')
    expect(unsupportedAdvice('linear ABC-12')).toContain('Linear MCP server')
    expect(unsupportedAdvice('outlook thread')).toContain('Gmail threads are already supported')
  })

  test('anything unknown is told to bring a logged-in CLI or an MCP server', () => {
    const r = parseWatchArgs('foo bar')
    expect(r.cmd).toBe('unsupported')
    const advice = unsupportedAdvice('foo bar')
    expect(advice).toContain('"foo bar"')
    expect(advice).toContain('CLI')
    expect(advice).toContain('MCP server')
  })

  test('a watch that cannot be read says what is missing, by kind', () => {
    expect(problemFor('mail', 'tool')).toContain('Gmail connector')
    expect(problemFor('mail', 'failed', 'timeout')).toContain('timeout')
    expect(problemFor('pr', 'tool')).toContain('`gh`')
    expect(problemFor('issue', 'failed', 'not found')).toContain('not found')
  })
})
