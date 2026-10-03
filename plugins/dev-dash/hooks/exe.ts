// dev-dash: finding and running `git` and `gh` when the process PATH may be stale. No session needed, so it tests
// with a stub for the process call and a stub clock.
//
// $.process.run rejects both when a program cannot be started and when it started but ran past its time limit
// (the child is killed and the call rejects). The API gives no wording for either, so the two are told apart by
// time: a program that cannot start fails almost at once, a timeout takes the whole allowance. A call that ran for
// (nearly) its whole timeoutMs was a timeout and is rethrown as it is; one that failed sooner is treated as "not
// there" and the next place is tried.

/** A call that ran for at least this much less than its allowance than the full timeoutMs still counts as a timeout. */
export const TIMEOUT_SLACK_MS = 250

/** True when a call that started at `startedAt` and failed at `endedAt` ran for (nearly) all of `timeoutMs`. */
export function ranToTimeout(startedAt: number, endedAt: number, timeoutMs: number): boolean {
  // The slack never takes more than half the allowance, so a very short timeout still means something.
  return endedAt - startedAt >= Math.max(timeoutMs / 2, timeoutMs - TIMEOUT_SLACK_MS)
}

export type RunExe<R> = {
  /** Starts `argv` (argv[0] the program) with the given time limit; rejects if it cannot start or runs out of time. */
  run: (argv: string[], timeoutMs: number) => Promise<R>
  /** The program as it is called by name: `git`, `gh`. */
  name: string
  args: string[]
  timeoutMs: number
  /** Where else to look, in order, asked only once the program by name could not be started. */
  fallbacks: () => Promise<string[]>
  /** What worked last time, by name; the caller keeps it between calls. */
  found: Map<string, string>
  now?: () => number
}

type Attempt<R> = { value: R } | { err: unknown; isTimeout: boolean }

/**
 * Runs the program: by the path that worked last time, else by name, else from each fallback in turn. A timeout is
 * rethrown at once from wherever it happened (a slow program is not retried elsewhere, and a remembered path that
 * timed out is kept); any other failure moves on to the next place. If nowhere works, the first failure is thrown.
 */
export async function runExe<R>(o: RunExe<R>): Promise<R> {
  const now = o.now ?? Date.now
  const attempt = async (exe: string): Promise<Attempt<R>> => {
    const started = now()
    try {
      return { value: await o.run([exe, ...o.args], o.timeoutMs) }
    } catch (err) {
      return { err, isTimeout: ranToTimeout(started, now(), o.timeoutMs) }
    }
  }

  const known = o.found.get(o.name)
  if (known) {
    const a = await attempt(known)
    if ('value' in a) return a.value
    if (a.isTimeout) throw a.err
    o.found.delete(o.name)
  }
  const first = await attempt(o.name)
  if ('value' in first) {
    o.found.set(o.name, o.name)

    return first.value
  }
  if (first.isTimeout) throw first.err
  for (const exe of await o.fallbacks()) {
    const a = await attempt(exe)
    if ('value' in a) {
      o.found.set(o.name, exe)

      return a.value
    }
    if (a.isTimeout) throw a.err
  }
  throw first.err
}
