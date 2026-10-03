// dev-dash: spotting a test run in a shell command, for the per-session test badge.
// Pure functions only, so they test without a session. register.tsx records the outcome of each call.
//
// Only a short runner label ("npm test", "pytest") is ever kept, never the command line itself:
// a command can carry arguments, paths or secrets.

import type { TestRun } from '../types'

/** [pattern, label]. Matched against one command segment with quoted text already removed. */
const RUNNERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?(test)(?::\S+)?(?=\s|$)/, '$1 $2'],
  [/\bnpx\s+(vitest|jest|mocha)\b/, '$1'],
  [/(?:^|\s)(vitest|jest|mocha)(?=\s|$)/, '$1'],
  [/\bpython3?\s+-m\s+(pytest|unittest)\b/, '$1'],
  [/(?:^|\s)(pytest|tox|nox|rspec|phpunit)(?=\s|$)/, '$1'],
  [/\bgo\s+test\b/, 'go test'],
  [/\bcargo\s+(test|nextest)\b/, 'cargo $1'],
  [/\bdotnet\s+test\b/, 'dotnet test'],
  [/\b(mvn|mvnw)\b(?:\s+\S+)*?\s+test\b/, '$1 test'],
  [/\bgradlew?\s+test\b/, 'gradle test'],
  [/\bclaude\s+plugin\s+test\b/, 'claude plugin test'],
]

/** Commands that mention a runner without running it (searching, printing, committing). */
const NOT_RUNNING = new Set(['echo', 'printf', 'grep', 'egrep', 'rg', 'cat', 'type', 'ls', 'dir', 'find', 'head', 'tail', 'sed', 'awk', 'git', 'gh', 'which', 'where', 'man', 'help', 'less', 'more', 'select-string', 'get-content'])

/** The command with anything inside quotes blanked, so `git commit -m "fix jest"` mentions nothing. */
const unquoted = (cmd: string) => cmd.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ' ')

/** `cd x && npm test | tee out` -> ['cd x', 'npm test', 'tee out'] */
const segments = (cmd: string) => unquoted(cmd).split(/&&|\|\||;|\||\r?\n/).map(s => s.trim()).filter(Boolean)

/** A short runner label if the command runs a test suite, else null. */
export function testRunnerOf(command: string): string | null {
  for (const seg of segments(command)) {
    const first = seg.split(/\s+/)[0].replace(/^.*[\\/]/, '').toLowerCase()
    if (NOT_RUNNING.has(first)) continue
    for (const [re, label] of RUNNERS) {
      const m = re.exec(seg)
      if (m) return label.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '').trim()
    }
  }

  return null
}

/** The outcome of a call that ran `command`, or null when it was not a test run. */
export const testRunOf = (command: string, isOk: boolean, at: number): TestRun | null => {
  const runner = testRunnerOf(command)

  return runner ? { ok: isOk, at, runner } : null
}

/** The badge text for a session row: `✓ tests pass · npm test · 2m ago`. */
export const testBadge = (t: TestRun | null | undefined, now: number, ago: (ms: number) => string) =>
  t ? `${t.ok ? '✓ tests pass' : '✗ tests failed'} · ${t.runner} · ${ago(now - t.at)} ago` : ''
