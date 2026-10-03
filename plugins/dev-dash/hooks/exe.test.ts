import { describe, expect, test } from 'claude-code/testing'

import { isTimeout } from './exe'

describe('telling a timeout from a missing program', () => {
  test('timeouts are recognised in the wordings they come in', () => {
    for (const msg of ['process timed out after 10000ms', 'git timeout', 'Timed out waiting for git', 'deadline exceeded: git not responding', 'time-out', 'it took too long']) {
      expect(isTimeout(new Error(msg))).toBe(true)
    }
  })

  test('a program that is not there is not a timeout, in any of its wordings', () => {
    for (const msg of ['spawn git ENOENT', "'git' is not recognized as an internal or external command", 'git: command not found', 'The system cannot find the file specified', 'cannot start git', 'No such file or directory']) {
      expect(isTimeout(new Error(msg))).toBe(false)
    }
  })

  test('anything unrecognised is not a timeout, so it is treated as not found as before', () => {
    expect(isTimeout(new Error('fatal: not a git repository'))).toBe(false)
    expect(isTimeout(new Error('permission denied'))).toBe(false)
    expect(isTimeout(new Error('process.run hook failed'))).toBe(false)
  })

  test('plain strings, nothing, and odd values do not throw', () => {
    expect(isTimeout('spawn gh ETIMEDOUT')).toBe(true)
    expect(isTimeout('request timed out')).toBe(true)
    expect(isTimeout(undefined)).toBe(false)
    expect(isTimeout(null)).toBe(false)
    expect(isTimeout({})).toBe(false)
  })
})
