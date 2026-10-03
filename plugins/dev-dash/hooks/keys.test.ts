import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, PrRow, SessionRow, Snapshot } from '../types'
import { attentionOf, itemsOf } from './attention'
import {
  HELP_KEYS,
  SNOOZE_MS,
  actionsFor,
  dismissAdd,
  ids,
  isMuted,
  noMuting,
  resumeCommand,
  snoozeAdd,
} from './keys'

const NOW = 1_800_000_000_000

const session = (over: Partial<SessionRow>): SessionRow => ({
  id: 's1', name: 'Session', app: 'cli', hasPlugin: true, waitingFor: '', cwd: '/w', repo: 'api', branch: 'main',
  state: 'idle', stateSince: NOW - 60_000, startedAt: NOW - 600_000, lastTool: '', costUsd: null, contextPct: null,
  updatedAt: NOW, stuck: '', editing: [], risky: '', ctxTrend: [], cacheHitPct: null, summary: '', ...over,
})

const pr = (over: Partial<PrRow>): PrRow => ({
  number: 1, title: 'A PR', repo: 'api', url: 'https://github.com/o/api/pull/1', author: 'me', ageDays: 1,
  review: 'none', ci: 'passing', conflicts: false, ...over,
})

const agent = (over: Partial<AgentRow>): AgentRow => ({
  id: 'ag1', sessionId: 's1', sessionName: 'Session', type: 'general-purpose', description: 'Research', state: 'working',
  isBackground: true, startedAt: NOW, lastActive: NOW, doing: '', steps: 1, ...over,
})

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  selfId: 'self',
  sessions: [
    session({ id: 'a', name: 'Fix tests', state: 'waiting', waitingFor: 'input needed', stateSince: NOW - 180_000 }),
    session({ id: 'b', name: 'Login work', state: 'running', stuck: 'npm test failed 3×' }),
    session({ id: 'c', name: 'Docs', state: 'idle' }),
  ],
  agents: [agent({ id: 'x1', sessionId: 'a' })],
  limits: [],
  events: [],
  alertsOn: true,
  bandOn: true,
  summariesOn: false,
  paneOpen: true,
  disks: [],
  git: null,
  prs: { error: null, mine: [pr({ number: 42, ci: 'failing' })], toReview: [pr({ number: 7, author: 'teammate', url: 'https://github.com/o/web/pull/7', repo: 'web' })], fetchedAt: NOW },
  updatedAt: NOW,
  ...over,
})

const caps = { reviews: 5, sessions: 10, agents: 8 }

describe('the help text', () => {
  test('explains the generic keys and nothing that needs a letter', () => {
    const keys = HELP_KEYS.map(([k]) => k).join(' | ')
    for (const word of ['Enter', 'Esc', 'ctrl+x tab', 'Tab']) expect(keys).toContain(word)
    for (const [, what] of HELP_KEYS) expect(what.length).toBeGreaterThan(8)
  })
})

describe('snooze and dismiss', () => {
  test('a snooze hides a row until its time passes', () => {
    const snoozed = snoozeAdd({}, 'wait:a:1', NOW)
    expect(snoozed['wait:a:1']).toBe(NOW + SNOOZE_MS)
    expect(isMuted({ snoozed, dismissed: [], now: NOW + 1000 }, 'wait:a:1')).toBe(true)
    expect(isMuted({ snoozed, dismissed: [], now: NOW + SNOOZE_MS + 1 }, 'wait:a:1')).toBe(false)
  })

  test('adding a snooze drops the ones that have already expired', () => {
    const out = snoozeAdd({ old: NOW - 1, live: NOW + 5000 }, 'new', NOW)
    expect(Object.keys(out).sort()).toEqual(['live', 'new'])
  })

  test('a dismissal holds until the id changes, and the list stays bounded', () => {
    const m = { snoozed: {}, dismissed: dismissAdd([], 'stuck:b:npm test failed 3×'), now: NOW }
    expect(isMuted(m, 'stuck:b:npm test failed 3×')).toBe(true)
    expect(isMuted(m, 'stuck:b:a different reason')).toBe(false)
    expect(dismissAdd(['x'], 'x')).toEqual(['x'])
    expect(dismissAdd(Array.from({ length: 5 }, (_, i) => String(i)), 'new', 3)).toEqual(['3', '4', 'new'])
  })

  test('a session that waits again is a new item, so an old dismissal does not hide it', () => {
    const first = session({ id: 'a', state: 'waiting', stateSince: 1000 })
    const again = session({ id: 'a', state: 'waiting', stateSince: 9000 })
    expect(ids.wait(first)).not.toBe(ids.wait(again))
  })
})

describe('what needs you', () => {
  test('counts everything, then less what is muted, and says how many are hidden', () => {
    const s = snapshot()
    const all = attentionOf(s, noMuting(NOW))
    expect(all.waiting.length).toBe(1)
    expect(all.stuck.length).toBe(1)
    expect(all.failing.length).toBe(1)
    expect(all.reviews.length).toBe(1)
    expect(all.total).toBe(4)
    expect(all.hidden).toBe(0)

    const waitId = ids.wait(s.sessions[0])
    const muted = attentionOf(s, { snoozed: { [waitId]: NOW + 5000 }, dismissed: [ids.stuck(s.sessions[1])], now: NOW })
    expect(muted.waiting.length).toBe(0)
    expect(muted.stuck.length).toBe(0)
    expect(muted.total).toBe(2)
    expect(muted.hidden).toBe(2)
  })
})

describe('the rows that can be opened', () => {
  test('are listed in the order the pane draws them', () => {
    const s = snapshot()
    const items = itemsOf(s, attentionOf(s, noMuting(NOW)), [], caps)
    expect(items.map(i => i.id.split(':')[0])).toEqual(['wait', 'stuck', 'ci', 'review', 's', 's', 's', 'a', 'pr', 'rv'])
  })

  test('a folded section has no rows, and a muted row is not selectable', () => {
    const s = snapshot()
    const att = attentionOf(s, noMuting(NOW))
    expect(itemsOf(s, att, ['sessions', 'agents', 'prs'], caps).every(i => i.kind === 'attention')).toBe(true)
    expect(itemsOf(s, att, ['attention'], caps).some(i => i.kind === 'attention')).toBe(false)
    const muted = attentionOf(s, { snoozed: {}, dismissed: [ids.review(s.prs!.toReview[0])], now: NOW })
    expect(itemsOf(s, muted, [], caps).some(i => i.id.startsWith('review:'))).toBe(false)
  })

  test('only Attention rows can be muted', () => {
    const s = snapshot()
    const items = itemsOf(s, attentionOf(s, noMuting(NOW)), [], caps)
    for (const i of items) expect(i.canMute).toBe(i.kind === 'attention')
  })

  test('what c copies: a resume command for sessions, a link for PRs', () => {
    const s = snapshot()
    const items = itemsOf(s, attentionOf(s, noMuting(NOW)), [], caps)
    expect(items.find(i => i.id === 's:c')?.copy).toBe('claude --resume c')
    expect(items.find(i => i.id === 'a:x1')?.copy).toBe(resumeCommand('a'))
    expect(items.find(i => i.id === 'rv:web#7')?.copy).toBe('https://github.com/o/web/pull/7')
  })

  test('the number of rows follows the caps the pane draws', () => {
    const s = snapshot()
    const items = itemsOf(s, attentionOf(s, noMuting(NOW)), [], { reviews: 0, sessions: 1, agents: 0 })
    expect(items.filter(i => i.kind === 'session').length).toBe(1)
    expect(items.filter(i => i.kind === 'agent').length).toBe(0)
    expect(items.some(i => i.id.startsWith('review:'))).toBe(false)
  })
})

describe('what a row offers', () => {
  const s = snapshot()
  const items = itemsOf(s, attentionOf(s, noMuting(NOW)), [], caps)

  test('an Attention row can be copied, snoozed and dismissed', () => {
    const wait = items.find(i => i.id.startsWith('wait:'))!
    expect(actionsFor(wait).map(a => a.id)).toEqual(['copy', 'snooze', 'dismiss'])
    expect(actionsFor(wait)[0].label).toBe('copy resume command')
  })

  test('a session, an agent and a PR can only be copied, and the label says what', () => {
    expect(actionsFor(items.find(i => i.id === 's:c')!).map(a => a.id)).toEqual(['copy'])
    expect(actionsFor(items.find(i => i.id === 'a:x1')!)[0].label).toBe('copy resume command for its session')
    expect(actionsFor(items.find(i => i.id === 'rv:web#7')!)).toEqual([{ id: 'copy', label: 'copy PR link' }])
  })
})
