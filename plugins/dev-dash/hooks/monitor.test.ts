import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, SessionRow } from '../types'
import { ids, isMuted } from './keys'
import {
  agentStateOf,
  cacheHitPct,
  isDiskLow,
  parseDf,
  parseWindowsDisks,
  riskyReason,
  summaryPrompt,
  tidySummary,
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
  risky: '',
  ctxTrend: [],
  cacheHitPct: null,
  summary: '',
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
      ['Docs finished after 5m', true],
      ['agent finished: Research ideas', true],
      ['#42 CI went red', true],
    ])
  })
})

describe('risky commands', () => {
  test('flags destructive commands', () => {
    expect(riskyReason('rm -rf build/')).toBe('rm -rf')
    expect(riskyReason('rm -fr ~/tmp')).toBe('rm -rf')
    expect(riskyReason('git push origin main --force')).toBe('git push --force')
    expect(riskyReason('git push -f')).toBe('git push --force')
    expect(riskyReason('git reset --hard HEAD~3')).toBe('git reset --hard')
    expect(riskyReason('git clean -fdx')).toBe('git clean -f')
    expect(riskyReason('Remove-Item .\dist -Recurse -Force')).toBe('Remove-Item -Recurse -Force')
    expect(riskyReason('psql -c "DROP TABLE users"')).toBe('DROP')
  })

  test('leaves safe commands alone', () => {
    expect(riskyReason('rm build/out.js')).toBe('')
    expect(riskyReason('git push --force-with-lease')).toBe('')
    expect(riskyReason('git reset --soft HEAD~1')).toBe('')
    expect(riskyReason('npm test')).toBe('')
  })
})

describe('cache and disks', () => {
  test('cache hit rate', () => {
    expect(cacheHitPct({ input_tokens: 100, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 })).toBe(80)
    expect(cacheHitPct({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBeNull()
    expect(cacheHitPct(undefined)).toBeNull()
  })

  test('Windows drives from Get-PSDrive', () => {
    const disks = parseWindowsDisks('C 53687091200 446676598784\r\nD  \r\nE 1073741824 0\r\n')
    expect(disks).toEqual([
      { name: 'C:', freeBytes: 53687091200, totalBytes: 500363689984 },
      { name: 'E:', freeBytes: 1073741824, totalBytes: 1073741824 },
    ])
  })

  test('df -Pk keeps real filesystems', () => {
    const out = [
      'Filesystem 1024-blocks Used Available Capacity Mounted on',
      '/dev/disk3s1 488245288 400000000 20000000 96% /',
      'devfs 200 200 0 100% /dev',
    ].join('\n')
    expect(parseDf(out)).toEqual([{ name: '/', freeBytes: 20000000 * 1024, totalBytes: 488245288 * 1024 }])
  })

  test('low means under 10% or under 5 GB free', () => {
    expect(isDiskLow({ name: 'C:', freeBytes: 4 * 1024 ** 3, totalBytes: 20 * 1024 ** 3 })).toBe(true)
    expect(isDiskLow({ name: 'C:', freeBytes: 40 * 1024 ** 3, totalBytes: 500 * 1024 ** 3 })).toBe(true)
    expect(isDiskLow({ name: 'C:', freeBytes: 100 * 1024 ** 3, totalBytes: 500 * 1024 ** 3 })).toBe(false)
  })
})

describe('risky events', () => {
  test('a newly risky session alerts once', () => {
    const before = remember([session({ id: 'a', name: 'Cleanup', state: 'running' })], [], null)
    const after = [session({ id: 'a', name: 'Cleanup', state: 'running', risky: 'git push --force' })]
    expect(changesBetween(before, after, [], null, 'self', NOW, false).map(c => [c.text, c.isAlert])).toEqual([
      ['Cleanup ran a risky command: git push --force', true],
    ])
    expect(changesBetween(remember(after, [], null), after, [], null, 'self', NOW, false)).toEqual([])
  })
})

describe('session summaries', () => {
  test('the prompt is small and carries request, steps and reply', () => {
    const p = summaryPrompt('Fix the login redirect', 'Done. I changed auth.ts so the redirect keeps the query string.', ['Read: auth.ts', 'Edit: auth.ts', 'Bash: npm test'])
    expect(p).toContain('Request: Fix the login redirect')
    expect(p).toContain('Read: auth.ts; Edit: auth.ts; Bash: npm test')
    expect(p).toContain('Reply: Done. I changed auth.ts')
    expect(summaryPrompt('x'.repeat(5000), 'y'.repeat(5000), []).length).toBeLessThan(1200)
  })

  test('tidy keeps one clean line', () => {
    expect(tidySummary('"Fixing the login redirect bug."')).toBe('Fixing the login redirect bug')
    expect(tidySummary('Status: **Refactoring the auth module**\nextra words')).toBe('Refactoring the auth module')
    expect(tidySummary('')).toBe('')
    expect(tidySummary('word '.repeat(40), 30).length).toBe(30)
  })
})

describe('toasts and muting', () => {
  test('a toast carries the id of its Attention row, so snoozing the row silences it', () => {
    const waiting = session({ id: 'a', name: 'Fix tests', state: 'waiting', waitingFor: 'input needed', stateSince: NOW - 1000 })
    const before = remember([session({ id: 'a', name: 'Fix tests', state: 'running', stateSince: NOW - 30_000 })], [], null)
    const [change] = changesBetween(before, [waiting], [], null, 'self', NOW, false)
    expect(change.isAlert).toBe(true)
    expect(change.itemId).toBe(ids.wait(waiting))
    expect(isMuted({ snoozed: { [ids.wait(waiting)]: NOW + 60_000 }, dismissed: [], now: NOW }, change.itemId ?? '')).toBe(true)
  })

  test('changes that are not Attention rows have no id and are never silenced', () => {
    const before = remember([], [], null)
    const [started] = changesBetween(before, [session({ id: 'n', name: 'New one' })], [], null, 'self', NOW, false)
    expect(started.text).toBe('New one started')
    expect(started.itemId).toBeUndefined()
  })
})
