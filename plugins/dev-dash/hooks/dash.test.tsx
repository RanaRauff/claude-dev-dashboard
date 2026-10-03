import { expect, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'dev-dash', props: { title: 'Dev dashboard', isFocused: false } } as const

const GIT: Record<string, string> = {
  'rev-parse --abbrev-ref HEAD': 'feat/login\n',
  'rev-parse --show-toplevel': '/w/api\n',
  'status --porcelain': ' M a.ts\n M b.ts\n?? c.ts\n',
  'rev-list --left-right --count @{u}...HEAD': '1\t2\n',
  'stash list': 'stash@{0}: WIP\n',
  'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main\n',
  'worktree list --porcelain': 'worktree /w/api\nbranch refs/heads/feat/login\n',
  'branch --merged main --format=%(refname:short)': 'main\nold-fix\n',
}

const PRS_MINE = JSON.stringify([
  {
    number: 42, title: 'Add login', author: { login: 'me' }, createdAt: '2026-10-01T00:00:00Z',
    reviewDecision: 'APPROVED', statusCheckRollup: [{ conclusion: 'FAILURE' }], mergeable: 'MERGEABLE',
  },
])
const PRS_REVIEW = JSON.stringify([
  { number: 7, title: 'Fix cache', author: { login: 'teammate' }, createdAt: '2026-09-29T00:00:00Z', statusCheckRollup: [] },
])

test('/dash shows attention, work in flight and PRs from git and gh', { timeoutMs: 15_000 }, async ($, on) => {
  const files = new Map<string, string>()
  const panes: string[] = []
  on('ui.open', async (_$, e) => {
    panes.push(e.id)
    return { value: { id: e.id } }
  })
  on('ui.close', async (_$, e) => {
    panes.splice(panes.indexOf(e.id), 1)
    return { value: undefined }
  })
  on('process.run', async (_$, e) => {
    const [cmd, ...args] = e.argv
    const key = args.join(' ')
    if (cmd === 'git') {
      if (key.startsWith('for-each-ref')) return { value: { exitCode: 0, stdout: 'feat/login|1 hour ago\nold-fix|3 weeks ago\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      const out = GIT[key]
      return { value: { exitCode: out === undefined ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const stdout = args.includes('@me') && args.includes('--author') ? PRS_MINE : PRS_REVIEW
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', async (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', async () => ({
    value: [...files.keys()].map(p => ({ name: p.split('/').pop() ?? p, kind: 'file' as const, size: 1, mtimeMs: Date.now(), isLink: false })),
  }))
  on('fs.read', async (_$, e) => {
    const hit = [...files.entries()].find(([p]) => p.endsWith(`/${String(e.path).split('/').pop()}`))
    return { value: hit ? hit[1] : '' }
  })

  const opened = await $.command.run({ command: 'dash', args: '' })
  expect(opened.text).toBe('Dashboard opened.')
  expect(panes).toEqual(['dev-dash'])
  await new Promise(resolve => setTimeout(resolve, 300))

  const ui = await $.ui.mount({ plugin: 'dev-dash', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /3 uncommitted/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /merged into main/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /CI failing/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /review #7 @teammate/ })).toBeDefined()
  expect(await ui.find({ key: 'hide' })).toBeDefined()
  await ui.unmount()

  const hidden = await $.command.run({ command: 'dash-hide', args: '' })
  expect(hidden.text).toBe('Dashboard hidden.')
  expect(panes).toEqual([])
})
