// dev-dash: telling "the program ran out of time" from "the program is not there". Pure, so it tests without a session.
//
// $.process.run rejects both when a program cannot be started and when it started but ran past its time limit.
// Only the first is a reason to look for the program somewhere else; a slow `git` must not be retried against
// every fallback path. The exact wording of "not found" differs between systems and engine versions, so the check
// is for what is recognisable (a timeout) and anything else is treated as not found, as it always was.

/** True for a failure that is a timeout: the program was found and started, and ran out of time. */
export function isTimeout(err: unknown): boolean {
  const msg = String((err as { message?: unknown } | null | undefined)?.message ?? err ?? '')

  return /time(d)?[ -]?out|timeout|deadline|took too long/i.test(msg)
}
