import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, SessionRow } from '../types'
import {
  agentStateOf,
  changesBetween,
  collisionsOf,
  crossedSteps,
  emptySeen,
  parseShortstat,
  remember,
  runwayMs,
  stuckReason,
  summarizeAgent,
} from './monitor'

const NOW = 1_800_000_000_000

const session = (over: Partial<SessionRow>): SessionRow => ({
  id: 's',
  name: '',
  app: 'cli',
  hasPlugin: true,
  waitingFor: '',
  cwd: '/w/api',
  repo: 'api',
  branch: 'main',
  state: 'idle',
  stateSince: NOW - 120_000,
  startedAt: NOW - 600_000,
  lastTool: '',
  costUsd: null,
  contextPct: null,
  updatedAt: NOW,
  stuck: '',
  editing: [],
  ...over,
})

describe('agents', () => {
  const line = (o: object) => JSON.stringify(o)
  const use = (name: string, input: object) => ({ type: 'tool_use', name, input })

  test('reads start time, steps and the latest step', () => {
    const text = [
      line({ type: 'user', timestamp: '2026-10-03T08:40:00.000Z', message: { content: 'go' } }),
      line({ type: 'assistant', message: { content: [use('WebSearch', { query: 'claude code dashboards' })] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      line({ type: 'assistant', message: { content: [use('Read', { file_path: 'C:\\repo\\src\\app.ts' })] } }),
    ].join('\n')
    const sum = summarizeAgent(text)
    expect(sum.startedAt).toBe(Date.parse('2026-10-03T08:40:00.000Z'))
    expect(sum.steps).toBe(2)
    expect(sum.doing).toBe('Read: app.ts')
    expect(sum.isFinished).toBe(false)
  })

  test('a hand-back or a final text reply means done', () => {
    const handback = line({ type: 'assistant', message: { content: [use('SubagentHandback', { message: 'report' })] } })
    expect(summarizeAgent(handback).isFinished).toBe(true)
    const reply = line({ type: 'assistant', message: { content: [{ type: 'text', text: 'All done.' }] } })
    expect(summarizeAgent(reply).isFinished).toBe(true)
  })

  test('state: stopped beats everything, then done, then working or quiet by recency', () => {
    const open = { startedAt: NOW, steps: 1, doing: '', isFinished: false }
    expect(agentStateOf({ stoppedByUser: true }, open, NOW, NOW, true)).toBe('stopped')
    expect(agentStateOf({}, { ...open, isFinished: true }, NOW, NOW, true)).toBe('done')
    expect(agentStateOf({}, open, NOW - 10_000, NOW, true)).toBe('working')
    expect(agentStateOf({}, open, NOW - 300_000, NOW, true)).toBe('quiet')
  })
})

describe('limits', () => {
  test('runway extrapolates the recent pace', () => {
    // 10 points in 10 minutes from 60%: 40 points left takes 40 minutes.
    expect(runwayMs([{ at: NOW - 600_000, pct: 50 }, { at: NOW, pct: 60 }])).toBe(2_400_000)
  })

  test('no runway when flat, falling, or too little history', () => {
    expect(runwayMs([{ at: NOW, pct: 50 }])).toBeNull()
    expect(runwayMs([{ at: NOW - 600_000, pct: 50 }, { at: NOW, pct: 50 }])).toBeNull()
    expect(runwayMs([{ at: NOW - 60_000, pct: 50 }, { at: NOW, pct: 55 }])).toBeNull()
  })

  test('context steps crossed upward', () => {
    expect(crossedSteps(48, 77)).toEqual([50, 75])
    expect(crossedSteps(80, 70)).toEqual([])
    expect(crossedSteps(null, 95)).toEqual([])
  })
})

describe('stuck and collisions', () => {
  const mark = (key: string, isOk: boolean) => ({ key, label: key, isOk, at: NOW })

  test('three failures of the same call in a row', () => {
    expect(stuckReason([mark('npm test', false), mark('npm test', false), mark('npm test', false)])).toBe('npm test failed 3× in a row')
    expect(stuckReason([mark('npm test', false), mark('npm test', true), mark('npm test', false)])).toBe('')
  })

  test('six identical calls in a row', () => {
    expect(stuckReason(Array.from({ length: 6 }, () => mark('ls', true)))).toBe('repeating ls')
  })

  test('the same file edited by two sessions', () => {
    const a = session({ id: 'a', name: 'Login work', editing: ['/w/api/src/auth.ts', '/w/api/README.md'] })
    const b = session({ id: 'b', name: 'Refactor', editing: ['/w/api/src/auth.ts'] })
    expect(collisionsOf([a, b])).toEqual([{ file: '/w/api/src/auth.ts', sessions: ['Login work', 'Refactor'] }])
  })

  test('shortstat', () => {
    expect(parseShortstat(' 3 files changed, 120 insertions(+), 30 deletions(-)')).toEqual({ added: 120, removed: 30 })
    expect(parseShortstat('')).toEqual({ added: 0, removed: 0 })
  })
})

describe('events', () => {
  const agent = (state: AgentRow['state']): AgentRow => ({
    id: 'x',
    sessionId: 'a',
    sessionName: 'api',
    type: 'general-purpose',
    description: 'Research ideas',
    state,
    isBackground: true,
    startedAt: NOW,
    lastActive: NOW,
    doing: '',
    steps: 0,
  })

  test('nothing on the first look', () => {
    expect(changesBetween(emptySeen(), [session({ state: 'waiting' })], [agent('working')], null, 'self', NOW, true)).toEqual([])
  })

  test('a session that starts waiting alerts; finishing and agents are noted', () => {
    const before = remember(
      [session({ id: 'a', name: 'Login work', state: 'running', stateSince: NOW - 300_000 }), session({ id: 'b', name: 'Docs', state: 'running', stateSince: NOW - 300_000 })],
      [agent('working')],
      [{ number: 42, title: 'Add login', repo: 'api', url: '', author: 'me', ageDays: 1, review: 'none', ci: 'passing', conflicts: false }],
    )
    const changes = changesBetween(
      before,
      [session({ id: 'a', name: 'Login work', state: 'waiting', waitingFor: 'input needed' }), session({ id: 'b', name: 'Docs', state: 'idle' })],
      [agent('done')],
      [{ number: 42, title: 'Add login', repo: 'api', url: '', author: 'me', ageDays: 1, review: 'none', ci: 'failing', conflicts: false }],
      'self',
      NOW,
      false,
    )
    expect(changes.map(c => [c.text, c.isAlert])).toEqual([
      ['Login work needs input needed', true],
      ['Docs finished', false],
      ['agent finished: Research ideas', true],
      ['#42 CI went red', true],
    ])
  })
})
