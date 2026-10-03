import { describe, expect, test } from 'claude-code/testing'

import { clip, FILES_MAX, HANDOFFS_KEPT, handoffName, handoffNote, staleNotes, SUMMARY_MAX } from './handoff'
import type { HandoffFacts } from './handoff'

const AT = new Date(2026, 9, 3, 16, 42, 7).getTime()

const facts = (over: Partial<HandoffFacts> = {}): HandoffFacts => ({
  at: AT,
  sessionId: '9c4304ab-1111-2222-3333-444455556666',
  name: 'Build login',
  repo: 'api',
  branch: 'feat/login',
  cwd: '/w/api',
  trigger: 'manual',
  tokensBefore: 182_000,
  tokensAfter: 21_500,
  plan: { done: 2, total: 5, current: 'Writing the login form' },
  lastTool: 'Edit: src/login.ts',
  files: ['/w/api/src/login.ts', '/w/api/src/form.tsx'],
  summary: 'We are adding OAuth login. The form is half done.',
  ...over,
})

describe('handoff note', () => {
  test('names where the session was, what it was doing and what it had touched', () => {
    const note = handoffNote(facts())
    expect(note).toContain('# Handoff: Build login')
    expect(note).toContain('Compacted 2026-10-03 16:42 (manual) (182k -> 22k tokens).')
    expect(note).toContain('Repo: api@feat/login · /w/api')
    expect(note).toContain('Resume: `claude --resume 9c4304ab-1111-2222-3333-444455556666`')
    expect(note).toContain('## Plan: 2/5 done')
    expect(note).toContain('In progress: Writing the login form')
    expect(note).toContain('Last step: Edit: src/login.ts')
    expect(note).toContain('- /w/api/src/login.ts')
    expect(note).toContain('## What the compaction kept\nWe are adding OAuth login.')
  })

  test('leaves out what it does not have', () => {
    const note = handoffNote(facts({ plan: null, files: [], lastTool: '', tokensBefore: undefined, tokensAfter: undefined, name: '', summary: '  ' }))
    expect(note).toContain('# Handoff: api@feat/login')
    expect(note).not.toContain('## Plan')
    expect(note).not.toContain('Files touched')
    expect(note).not.toContain('Last step')
    expect(note).not.toContain('tokens)')
    expect(note).toContain('(no summary text)')
    expect(note).not.toMatch(/\n{3,}/)
  })

  test('a finished plan has no in-progress line', () => {
    expect(handoffNote(facts({ plan: { done: 3, total: 3, current: '' } }))).not.toContain('In progress')
  })

  test('long summaries and file lists are cut, and say so', () => {
    const files = Array.from({ length: FILES_MAX + 4 }, (_, i) => `/w/f${i}.ts`)
    const note = handoffNote(facts({ files, summary: 'x'.repeat(SUMMARY_MAX + 500) }))
    expect(note).toContain('… and 4 more')
    expect(note).not.toContain(`/w/f${FILES_MAX}.ts`)
    expect(note).toContain('…\n')
    expect(note.length).toBeLessThan(SUMMARY_MAX + 1200)
  })

  test('clip leaves short text alone', () => {
    expect(clip('short', 10)).toBe('short')
    expect(clip('abcdefghij', 5)).toBe('abcd…')
  })
})

describe('retention', () => {
  const name = (i: number) => `20261003-16${String(i).padStart(2, '0')}00-abcd1234.md`

  test('keeps the newest notes and names the older ones for deletion', () => {
    const names = Array.from({ length: 35 }, (_, i) => name(i)).reverse()
    const stale = staleNotes(names)
    expect(stale.length).toBe(35 - HANDOFFS_KEPT)
    expect(stale).toEqual([name(0), name(1), name(2), name(3), name(4)])
    expect(staleNotes(names, 40)).toEqual([])
    expect(staleNotes([], 30)).toEqual([])
  })

  test('only ever names files that look like our own notes', () => {
    const names = ['notes.md', '../x.md', 'README.md', '20261003-160000-abcd1234.txt', name(1), name(2)]
    expect(staleNotes(names, 1)).toEqual([name(1)])
    expect(staleNotes(['notes.md', 'x.md'], 0)).toEqual([])
  })
})

describe('handoff file name', () => {
  test('sorts by time and carries a short session id', () => {
    expect(handoffName(AT, '9c4304ab-1111-2222')).toBe('20261003-164207-9c4304ab.md')
    expect(handoffName(AT, '../../evil name')).toBe('20261003-164207-evilname.md')
    expect(handoffName(AT, '')).toBe('20261003-164207-session.md')
  })
})
