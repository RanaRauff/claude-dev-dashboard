import { describe, expect, test } from 'claude-code/testing'

import { testBadge, testRunnerOf, testRunOf } from './testrun'

describe('spotting a test run', () => {
  test('finds the common runners', () => {
    const cases: Array<[string, string]> = [
      ['npm test', 'npm test'],
      ['npm run test:unit -- --watch=false', 'npm test'],
      ['pnpm test', 'pnpm test'],
      ['yarn test', 'yarn test'],
      ['bun test', 'bun test'],
      ['npx vitest run', 'vitest'],
      ['jest --ci', 'jest'],
      ['pytest -q tests/', 'pytest'],
      ['python -m pytest', 'pytest'],
      ['python3 -m unittest discover', 'unittest'],
      ['go test ./...', 'go test'],
      ['cargo test --release', 'cargo test'],
      ['cargo nextest run', 'cargo nextest'],
      ['dotnet test', 'dotnet test'],
      ['mvn -q clean test', 'mvn test'],
      ['./gradlew test', 'gradle test'],
      ['claude plugin test ./plugins/dev-dash', 'claude plugin test'],
    ]
    for (const [cmd, label] of cases) expect(testRunnerOf(cmd)).toBe(label)
  })

  test('finds it inside a chain or a pipe', () => {
    expect(testRunnerOf('cd api && npm test')).toBe('npm test')
    expect(testRunnerOf('cd C:\\w\\api; pytest -x | tee out.txt')).toBe('pytest')
    expect(testRunnerOf('FOO=1 go test ./... 2>&1')).toBe('go test')
  })

  test('does not mistake a mention for a run', () => {
    expect(testRunnerOf('echo "run npm test later"')).toBeNull()
    expect(testRunnerOf('git commit -m "fix jest config"')).toBeNull()
    expect(testRunnerOf('grep jest package.json')).toBeNull()
    expect(testRunnerOf("cat tests/pytest.ini")).toBeNull()
    expect(testRunnerOf('git log --oneline')).toBeNull()
    expect(testRunnerOf('npm install')).toBeNull()
    expect(testRunnerOf('npm run build')).toBeNull()
    expect(testRunnerOf('ls')).toBeNull()
    expect(testRunnerOf('')).toBeNull()
  })

  test('keeps only a label, never the command line', () => {
    const run = testRunOf('API_KEY=secret npm test -- --token=abc', true, 5)
    expect(run).toEqual({ ok: true, at: 5, runner: 'npm test' })
    expect(JSON.stringify(run)).not.toMatch(/secret|token|abc/)
    expect(testRunOf('ls', true, 5)).toBeNull()
  })
})

describe('the badge', () => {
  const ago = (ms: number) => `${Math.round(ms / 60_000)}m`
  test('says pass or fail, what ran and when; nothing when no test ran', () => {
    expect(testBadge({ ok: true, at: 0, runner: 'npm test' }, 120_000, ago)).toBe('✓ tests pass · npm test · 2m ago')
    expect(testBadge({ ok: false, at: 0, runner: 'pytest' }, 540_000, ago)).toBe('✗ tests failed · pytest · 9m ago')
    expect(testBadge(null, 1, ago)).toBe('')
    expect(testBadge(undefined, 1, ago)).toBe('')
  })
})
