import { describe, expect, test } from 'claude-code/testing'

import { dayStamp, money, parseCommits, parseMerged, recapText, sessionsToday, startOfDay } from './recap'
import { recapNow } from './recap-run'

// Local noon on 3 October 2026, and local midnight before it.
const NOON = new Date(2026, 9, 3, 12, 0, 0).getTime()
const MIDNIGHT = new Date(2026, 9, 3, 0, 0, 0).getTime()

const beat = (o: Record<string, unknown>) => JSON.stringify({ id: 'a1b2c3d4e5', name: 'web', cwd: '/w/web', branch: 'main', state: 'running', startedAt: NOON - 3_600_000, updatedAt: NOON, costUsd: 1.5, ...o })

describe('days', () => {
  test('midnight and the date stamp are local', () => {
    expect(startOfDay(NOON)).toBe(MIDNIGHT)
    expect(startOfDay(MIDNIGHT)).toBe(MIDNIGHT)
    expect(dayStamp(NOON)).toBe('2026-10-03')
    expect(dayStamp(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
  })
})

describe('sessions today', () => {
  test('keeps today, drops yesterday, counts a session once, skips files that are not sessions', () => {
    const got = sessionsToday(
      [
        { text: beat({}), mtimeMs: NOON },
        { text: beat({ updatedAt: NOON - 10 }), mtimeMs: NOON - 10 },
        { text: beat({ id: 'old', startedAt: MIDNIGHT - 90_000_000, updatedAt: MIDNIGHT - 80_000_000 }), mtimeMs: MIDNIGHT - 80_000_000 },
        { text: 'not json', mtimeMs: NOON },
        { text: '[1,2]', mtimeMs: NOON },
        { text: JSON.stringify({ name: 'no id' }), mtimeMs: NOON },
      ],
      MIDNIGHT,
    )
    expect(got.map(s => s.id)).toEqual(['a1b2c3d4e5'])
    expect(got[0].costUsd).toBe(1.5)
  })

  test('a session that started yesterday but is still going counts; names fall back to the id; bad costs are none', () => {
    const got = sessionsToday([{ text: beat({ id: 'longrunning', name: '', startedAt: MIDNIGHT - 5_000_000, costUsd: 'x' }), mtimeMs: NOON }], MIDNIGHT)
    expect(got[0].name).toBe('longrunn')
    expect(got[0].costUsd).toBeNull()
  })

  test('in the order they started', () => {
    const got = sessionsToday(
      [
        { text: beat({ id: 'b', startedAt: NOON - 100 }), mtimeMs: NOON },
        { text: beat({ id: 'a', startedAt: NOON - 900 }), mtimeMs: NOON },
      ],
      MIDNIGHT,
    )
    expect(got.map(s => s.id)).toEqual(['a', 'b'])
  })
})

describe('reading git and gh', () => {
  test('commits are hash, tab, subject; blank and odd lines are skipped', () => {
    expect(parseCommits('web', 'abc1234\tFix the login\r\n\r\nnonsense\ndef5678\tAdd\ttabs in subject\n')).toEqual([
      { repo: 'web', hash: 'abc1234', subject: 'Fix the login' },
      { repo: 'web', hash: 'def5678', subject: 'Add\ttabs in subject' },
    ])
    expect(parseCommits('web', '')).toEqual([])
  })

  test('merged PRs come from the repository, number and title; anything else is null', () => {
    const json = JSON.stringify([{ number: 18, title: ' Boxes ', repository: { name: 'dash', nameWithOwner: 'o/dash' } }, { title: 'no number' }])
    expect(parseMerged(json)).toEqual([{ repo: 'o/dash', number: 18, title: 'Boxes' }])
    expect(parseMerged('[]')).toEqual([])
    expect(parseMerged('{}')).toBeNull()
    expect(parseMerged('oops')).toBeNull()
  })
})

describe('the recap text', () => {
  const s = (name: string, costUsd: number | null) => ({ id: name, name, cwd: '/w', branch: 'feat/x', costUsd, startedAt: NOON })

  test('sessions with cost, commits, merged PRs', () => {
    const t = recapText({
      day: 'Sat 3 Oct',
      sessions: [s('web', 1.5), s('api', 2.25)],
      commits: [{ repo: 'dash', hash: 'abc1234', subject: 'Fix it' }],
      merged: [{ repo: 'o/dash', number: 18, title: 'Boxes' }],
    })
    expect(t).toContain('Recap for Sat 3 Oct')
    expect(t).toContain('Sessions: 2, $3.75 in all')
    expect(t).toContain('web (feat/x) · $1.50 · from 12:00')
    expect(t).toContain('Commits: 1 in 1 repo')
    expect(t).toContain('dash abc1234 Fix it')
    expect(t).toContain('PRs merged: 1')
    expect(t).toContain('o/dash#18 Boxes')
  })

  test('nothing today says so; a part that could not be read says that, not "none"', () => {
    const empty = recapText({ day: 'd', sessions: [], commits: [], merged: [] })
    expect(empty).toContain('Sessions: none seen today')
    expect(empty).toContain('Commits: none today')
    expect(empty).toContain('PRs merged: none today')
    const broken = recapText({ day: 'd', sessions: [s('web', null)], commits: null, merged: null })
    expect(broken).toContain('Commits: could not read git')
    expect(broken).toContain('PRs merged: could not read gh')
    expect(broken).toContain('Sessions: 1\n')
    expect(broken).toContain('web (feat/x) · –')
    expect(money(null)).toBe('–')
  })

  test('long lists are cut at ten with a count of the rest', () => {
    const commits = Array.from({ length: 13 }, (_, i) => ({ repo: 'r', hash: `h${i}`, subject: `c${i}` }))
    const t = recapText({ day: 'd', sessions: [], commits, merged: [] })
    expect(t).toContain('r h9 c9')
    expect(t).not.toContain('r h10 c10')
    expect(t).toContain('… and 3 more')
  })
})

describe('/dash-recap end to end, with git and gh stubbed', () => {
  const dirEntries = [
    { kind: 'file', name: 'a.json', mtimeMs: NOON },
    { kind: 'file', name: 'old.json', mtimeMs: MIDNIGHT - 1000 },
    { kind: 'file', name: 'notes.txt', mtimeMs: NOON },
  ]
  const run = (git: (a: string[]) => Promise<string | null>, gh: (a: string[]) => Promise<string | null>, cwd = '/w/web') => {
    const read: string[] = []
    const out = recapNow({
      dir: '/cfg/dev-dash/sessions',
      cwd,
      fs: {
        list: async () => dirEntries,
        read: async p => {
          read.push(p)
          return beat({})
        },
      },
      git,
      gh,
      now: NOON,
    })

    return { out, read }
  }

  test('reads only today\'s heartbeat files, one repository once, with this repository\'s author and today\'s date', async () => {
    const calls: string[] = []
    const { out, read } = run(
      async a => {
        calls.push(a.join(' '))
        if (a.includes('rev-parse')) return 'C:/code/dash\n'
        if (a.includes('config')) return 'me@x.io\n'
        return 'abc1234\tFix it\n'
      },
      async () => JSON.stringify([{ number: 7, title: 'Merged one', repository: { nameWithOwner: 'o/dash' } }]),
    )
    const text = await out
    expect(read).toEqual(['/cfg/dev-dash/sessions/a.json'])
    expect(calls.filter(c => c.includes('rev-parse')).length).toBe(1)
    const log = calls.find(c => c.includes(' log '))
    expect(log).toContain('--author=me@x.io')
    expect(log).toContain('--since=2026-10-03 00:00')
    expect(log).toContain('--no-merges')
    // Every branch, so work on a branch other than the checked-out one counts.
    expect(log).toContain(' --all ')
    expect(text).toContain('dash abc1234 Fix it')
    expect(text).toContain('o/dash#7 Merged one')
    expect(text).toContain('Sessions: 1, $1.50 in all')
  })

  test('no git and no gh: both say they could not be read, and nothing throws', async () => {
    const text = await run(async () => null, async () => null).out
    expect(text).toContain('Commits: could not read git')
    expect(text).toContain('PRs merged: could not read gh')
  })

  test('a repository with no author email is skipped rather than showing everyone\'s commits', async () => {
    const calls: string[] = []
    const text = await run(
      async a => {
        calls.push(a.join(' '))
        if (a.includes('rev-parse')) return '/code/dash\n'
        if (a.includes('config')) return '\n'
        return 'abc1234\tSomeone else\n'
      },
      async () => '[]',
    ).out
    expect(calls.some(c => c.includes(' log '))).toBe(false)
    expect(text).toContain('Commits: none today')
  })
})
