import { describe, expect, test } from 'claude-code/testing'

import { ranToTimeout, runExe, TIMEOUT_SLACK_MS } from './exe'

// A stub process call and a stub clock: `time` only moves when a call "takes" time, so nothing really waits.
function harness(script: Record<string, { ok?: string; failAfterMs?: number }>) {
  let time = 1_000
  const tried: string[] = []
  const run = async (argv: string[], _timeoutMs: number) => {
    const exe = argv[0]
    tried.push(exe)
    const step = script[exe] ?? { failAfterMs: 5 }
    time += step.failAfterMs ?? 3
    if (step.ok !== undefined) return step.ok
    throw new Error(`${exe} failed`)
  }
  const found = new Map<string, string>()
  const call = (name = 'git', timeoutMs = 10_000, fallbacks = ['C:/P/git.exe', 'C:/Q/git.exe']) =>
    runExe({ run, name, args: ['status'], timeoutMs, fallbacks: async () => fallbacks, found, now: () => time })

  return { tried, found, call }
}

// How a call failed, as its message ('resolved' if it did not).
const failure = (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => (e as Error).message)

describe('telling a timeout from a program that is not there, by time', () => {
  test('a call that ran for (nearly) its whole allowance was a timeout; a quick failure was not', () => {
    expect(ranToTimeout(0, 10_000, 10_000)).toBe(true)
    expect(ranToTimeout(0, 10_000 - TIMEOUT_SLACK_MS, 10_000)).toBe(true)
    expect(ranToTimeout(0, 10_000 - TIMEOUT_SLACK_MS - 1, 10_000)).toBe(false)
    expect(ranToTimeout(0, 15, 10_000)).toBe(false)
    expect(ranToTimeout(0, 0, 10_000)).toBe(false)
  })

  test('the slack never makes a very short allowance meaningless', () => {
    expect(ranToTimeout(0, 40, 100)).toBe(false)
    expect(ranToTimeout(0, 60, 100)).toBe(true)
    expect(ranToTimeout(0, 100, 100)).toBe(true)
  })
})

describe('running git or gh', () => {
  test('found by name: no fallback is looked at, and the name is remembered', async () => {
    const h = harness({ git: { ok: 'main' } })
    expect(await h.call()).toBe('main')
    expect(h.tried).toEqual(['git'])
    expect(h.found.get('git')).toBe('git')
  })

  test('not there (fails at once): the install folders are tried in order, and the one that works is remembered', async () => {
    const h = harness({ git: { failAfterMs: 4 }, 'C:/P/git.exe': { failAfterMs: 4 }, 'C:/Q/git.exe': { ok: 'feat/x' } })
    expect(await h.call()).toBe('feat/x')
    expect(h.tried).toEqual(['git', 'C:/P/git.exe', 'C:/Q/git.exe'])
    expect(h.found.get('git')).toBe('C:/Q/git.exe')
    // The next call goes straight to the remembered path.
    h.tried.length = 0
    expect(await h.call()).toBe('feat/x')
    expect(h.tried).toEqual(['C:/Q/git.exe'])
  })

  test('a timeout by name is rethrown and no fallback is tried', async () => {
    const h = harness({ git: { failAfterMs: 10_000 } })
    expect(await failure(h.call())).toBe('git failed')
    expect(h.tried).toEqual(['git'])
    expect(h.found.size).toBe(0)
  })

  test('a timeout on a fallback path is rethrown and the next fallback is not tried', async () => {
    const h = harness({ git: { failAfterMs: 4 }, 'C:/P/git.exe': { failAfterMs: 10_000 } })
    expect(await failure(h.call())).toBe('C:/P/git.exe failed')
    expect(h.tried).toEqual(['git', 'C:/P/git.exe'])
  })

  test('a remembered path that fails at once is forgotten and looked up again', async () => {
    const h = harness({ git: { failAfterMs: 4 }, 'C:/P/git.exe': { ok: 'one' } })
    h.found.set('git', 'C:/Old/git.exe')
    expect(await h.call()).toBe('one')
    expect(h.tried).toEqual(['C:/Old/git.exe', 'git', 'C:/P/git.exe'])
    expect(h.found.get('git')).toBe('C:/P/git.exe')
  })

  test('a remembered path that times out is rethrown and stays remembered', async () => {
    const h = harness({ 'C:/Old/git.exe': { failAfterMs: 10_000 } })
    h.found.set('git', 'C:/Old/git.exe')
    expect(await failure(h.call())).toBe('C:/Old/git.exe failed')
    expect(h.tried).toEqual(['C:/Old/git.exe'])
    expect(h.found.get('git')).toBe('C:/Old/git.exe')
  })

  test('nowhere works: the first failure is thrown; with no fallbacks (not Windows) the same', async () => {
    const h = harness({})
    expect(await failure(h.call())).toBe('git failed')
    expect(h.tried).toEqual(['git', 'C:/P/git.exe', 'C:/Q/git.exe'])
    const none = harness({})
    expect(await failure(none.call('gh', 10_000, []))).toBe('gh failed')
    expect(none.tried).toEqual(['gh'])
  })

  test('a failure well short of the allowance is not a timeout, one that used it all is', async () => {
    const h = harness({ gh: { failAfterMs: 20_000 } })
    expect(await failure(h.call('gh', 20_000))).toBe('gh failed')
    expect(h.tried).toEqual(['gh'])
    const quick = harness({ gh: { failAfterMs: 20_000 } })
    expect(await failure(quick.call('gh', 100_000))).toBe('gh failed')
    expect(quick.tried).toEqual(['gh', 'C:/P/git.exe', 'C:/Q/git.exe'])
  })
})
