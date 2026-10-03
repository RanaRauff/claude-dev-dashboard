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

// What `gh api graphql` answers: your open PRs across repos, and the ones awaiting your review.
const GH_GRAPHQL = JSON.stringify({
  data: {
    mine: {
      nodes: [
        {
          number: 42, title: 'Add login', url: 'https://github.com/me/api/pull/42', createdAt: '2026-10-01T00:00:00Z',
          repository: { nameWithOwner: 'me/api' }, author: { login: 'me' }, reviewDecision: 'APPROVED', mergeable: 'MERGEABLE',
          commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
        },
      ],
    },
    review: {
      nodes: [
        {
          number: 7, title: 'Fix cache', url: 'https://github.com/team/web/pull/7', createdAt: '2026-09-29T00:00:00Z',
          repository: { nameWithOwner: 'team/web' }, author: { login: 'teammate' }, reviewDecision: null, mergeable: 'MERGEABLE',
          commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        },
      ],
    },
  },
})

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
    const stdout = GH_GRAPHQL
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
  expect(await ui.find({ key: 'key-close' })).toBeDefined()
  await ui.unmount()

  const hidden = await $.command.run({ command: 'dash-hide', args: '' })
  expect(hidden.text).toBe('Dashboard hidden.')
  expect(panes).toEqual([])
})

test('lists every live Claude session, with or without the plugin', { timeoutMs: 15_000 }, async ($, on) => {
  const now = Date.now()
  const files = new Map<string, string>([
    ['/cfg/sessions/100.json', JSON.stringify({ pid: 100, sessionId: 'self', cwd: '/w/web', startedAt: now - 60_000, name: 'web work', entrypoint: 'cli', status: 'busy' })],
    ['/cfg/sessions/200.json', JSON.stringify({ pid: 200, sessionId: 'other', cwd: '/w/api', startedAt: now - 120_000, name: 'Claude mods', entrypoint: 'claude-desktop', status: 'idle', statusUpdatedAt: now - 30_000 })],
    ['/cfg/sessions/300.json', JSON.stringify({ pid: 300, sessionId: 'gone', cwd: '/w/old', startedAt: now - 999_000, name: 'dead session', status: 'idle' })],
    ['/cfg/sessions/200.secret.key', 'never read'],
    ['/cfg/projects/-w-api/other/subagents/agent-x1.meta.json', JSON.stringify({ agentType: 'general-purpose', description: 'Research dashboard ideas', requestShape: 'background' })],
    ['/cfg/projects/-w-api/other/subagents/agent-x1.jsonl', [
      JSON.stringify({ type: 'user', timestamp: new Date(now - 300_000).toISOString(), message: { content: 'go' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'claude code dashboards' } }] } }),
    ].join('\n')],
    ['/cfg/sessions/400.json', JSON.stringify({ pid: 400, sessionId: 'named-by-folder', cwd: '/w/api', startedAt: now - 30_000, name: '2025-2a', nameSource: 'derived', entrypoint: 'cli', status: 'waiting', waitingFor: 'input needed', statusUpdatedAt: now - 10_000 })],
    ['/cfg/projects/-w-api/named-by-folder.jsonl', [
      JSON.stringify({ type: 'user', message: { content: 'secret prompt text' } }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'fix the flaky tests please' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Fix flaky tests' }),
    ].join('\n')],
  ])
  const reads: string[] = []
  const unify = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'self' }))
  on('session.cwd', async () => ({ value: '/w/web' }))
  on('session.usage', async () => ({ value: { startedAt: now - 60_000, context: { window: 200_000, percent: 42 }, rateLimits: [{ kind: 'five_hour', percentUsed: 62, resetsAt: new Date(now + 3_600_000).toISOString() }], cost: { usd: 0.5 } } }))
  on('env.get', async (_$, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('clock.every', async () => ({ value: undefined }))
  on('ui.open', async (_$, e) => ({ value: { id: e.id } }))
  on('ui.close', async () => ({ value: undefined }))
  // What Claude Code draws when no plugin claims the band: nothing, here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  on('process.run', async (_$, e) => {
    const [cmd, ...args] = e.argv
    if (cmd === 'tasklist') return ok('"claude.exe","100","Console","5","1 K"\n"claude.exe","200","Console","5","1 K"\n"claude.exe","400","Console","5","1 K"\n')
    if (cmd === 'git' && args.includes('--abbrev-ref')) return ok(args.includes('/w/api') ? 'feat/login\n' : 'main\n')
    if (cmd === 'git' && args.includes('--show-toplevel')) return ok(args.includes('/w/api') ? '/w/api\n' : '/w/web\n')
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', async (_$, e) => {
    files.set(unify(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', async (_$, e) => {
    const dir = `${unify(e.path)}/`
    const names = [...files.keys()].filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file' as const, size: 1, mtimeMs: now, isLink: false })) }
  })
  on('fs.stat', async (_$, e) => {
    const text = files.get(unify(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: text.length, mtimeMs: now, isLink: false } }
  })
  on('fs.read', async (_$, e) => {
    reads.push(unify(e.path))
    return { value: files.get(unify(e.path)) ?? '' }
  })

  await $.session.start({ cwd: '/w/web', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'dash', args: '' })
  await new Promise(resolve => setTimeout(resolve, 300))

  const ui = await $.ui.mount({ plugin: 'dev-dash', surface: 'terminal', ...PANE })
  const has = async (re: RegExp) => {
    if (!(await ui.find({ type: 'Text', text: re }))) throw new Error(`no text matching ${re}`)
  }
  await has(/Sessions \(3\)/)
  await has(/Claude mods · idle/)
  await has(/api@feat\/login · desktop · no plugin/)
  await has(/web work \(this\)/)
  await has(/Fix flaky tests · input needed/)
  await has(/◆ Fix flaky tests · input needed/)
  await has(/ctx 42%/)
  await has(/Agents \(1\)/)
  await has(/Research dashboard ideas/)
  await has(/↳ WebSearch: claude code dashboards/)
  await has(/5h .*62%/)
  await has(/resets in/)
  expect(await ui.find({ type: 'Text', text: /dead session/ })).toBeUndefined()
  expect(reads.some(p => p.endsWith('.key'))).toBe(false)
  await ui.unmount()

  // The band above the prompt steps aside while the pane is open...
  const BAND = {
    plugin: 'dev-dash',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 110 },
  } as const
  const hidden = await $.ui.mount(BAND as never)
  expect(await hidden.find({ type: 'Text', text: /need/ })).toBeUndefined()
  expect(await hidden.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await hidden.unmount()

  // ...and leads with the most urgent thing once it's closed.
  await $.command.run({ command: 'dash-hide', args: '' })
  const band = await $.ui.mount(BAND as never)
  for (const re of [/◆ 1 needs you/, /Fix flaky tests · input needed/, /5h 62%/, /\/dash/]) {
    if (!(await band.find({ type: 'Text', text: re }))) throw new Error(`band: no text matching ${re}`)
  }
  await band.unmount()
})

test('redesigned pane adapts to narrow and wide docks', { timeoutMs: 15_000 }, async ($, on) => {
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('ui.open', async (_$, e) => ({ value: { id: e.id } }))
  on('fs.write', async () => ({ value: undefined }))
  on('fs.list', async () => ({ value: [] }))
  on('fs.read', async () => ({ value: '' }))
  on('process.run', async (_$, e) => {
    const [cmd, ...args] = e.argv
    const key = args.join(' ')
    if (cmd === 'git') {
      if (key.startsWith('for-each-ref')) return ok('feat/login|1 hour ago\nold-fix|3 weeks ago\n')
      const out = GIT[key]
      return out === undefined ? { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } : ok(out)
    }
    if (cmd === 'gh') return ok(GH_GRAPHQL)
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.command.run({ command: 'dash', args: '' })
  await new Promise(resolve => setTimeout(resolve, 300))

  const at = async (cols: number) =>
    $.ui.mount({
      plugin: 'dev-dash',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'dev-dash',
      viewport: { columns: cols, rows: 40 },
      props: { title: 'Dev dashboard', isFocused: false, bodyColumns: cols - 2, placement: 'dock' },
    })

  const narrow = await at(45)
  for (const re of [/0 sess$/, /3 uncommitted/, /✗ CI/, /review #7 @teammate/]) {
    if (!(await narrow.find({ type: 'Text', text: re }))) throw new Error(`narrow: no text matching ${re}`)
  }
  // The header's activity trace is "claude beat": a connected line of solid line characters, not bars or dots.
  if (!(await narrow.find({ type: 'Text', text: /claude beat/ }))) throw new Error('narrow: no claude beat label')
  if (!(await narrow.find({ type: 'Text', text: /─{4,}/ }))) throw new Error('narrow: no claude beat line')
  expect(await narrow.find({ type: 'Text', text: /[▁-█]{3,}/ })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /0 sessions/ })).toBeUndefined()
  expect(await narrow.find({ key: 'key-close' })).toBeDefined()
  await narrow.unmount()

  const wide = await at(90)
  for (const re of [/0 sessions/, /3 uncommitted/, /✗ CI/, /Add login/]) {
    if (!(await wide.find({ type: 'Text', text: re }))) throw new Error(`wide: no text matching ${re}`)
  }
  await wide.unmount()
})

test('shows plan progress, sources and files changed from session heartbeats', { timeoutMs: 15_000 }, async ($, on) => {
  const now = Date.now()
  const beat = {
    id: 'worker', name: 'Build login', app: 'cli', hasPlugin: true, waitingFor: '', cwd: '/w/api', repo: 'api', branch: 'feat/login',
    state: 'running', stateSince: now - 5_000, startedAt: now - 600_000, lastTool: 'Edit', costUsd: 0.2, contextPct: 30, updatedAt: now,
    stuck: '', editing: [], risky: '', ctxTrend: [], cacheHitPct: null,
    plan: { done: 2, total: 5, current: 'Writing the login form' }, planAt: now - 20_000,
    sources: [
      { at: now - 60_000, kind: 'fetch', label: 'https://www.example.com/docs/auth/?x=1' },
      { at: now - 120_000, kind: 'search', label: 'oauth device flow' },
    ],
    turnFiles: [
      { path: '/w/api/src/login.ts', added: 40, removed: 3 },
      { path: '/w/api/src/form.tsx', added: 12, removed: 0 },
    ],
  }
  // A second session whose edits git could not count (git not found, say): listed as edited, without made-up numbers.
  const uncounted = { ...beat, id: 'worker2', name: 'Docs fixer', plan: null, sources: [], turnFiles: [{ path: '/w/api/README.md', added: 0, removed: 0, counted: false }] }
  const files = new Map<string, string>([
    ['/cfg/dev-dash/sessions/worker.json', JSON.stringify(beat)],
    ['/cfg/dev-dash/sessions/worker2.json', JSON.stringify(uncounted)],
  ])
  const unify = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  const none = { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'self' }))
  on('session.cwd', async () => ({ value: '/w/web' }))
  on('session.usage', async () => ({ value: { startedAt: now - 60_000, context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 0.1 } } }))
  on('env.get', async (_$, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('clock.every', async () => ({ value: undefined }))
  on('ui.open', async (_$, e) => ({ value: { id: e.id } }))
  on('ui.close', async () => ({ value: undefined }))
  on('process.run', async () => none)
  on('fs.write', async (_$, e) => {
    files.set(unify(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', async (_$, e) => {
    const dir = `${unify(e.path)}/`
    const names = [...files.keys()].filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file' as const, size: 1, mtimeMs: now, isLink: false })) }
  })
  on('fs.stat', async () => {
    throw new Error('ENOENT')
  })
  on('fs.read', async (_$, e) => ({ value: files.get(unify(e.path)) ?? '' }))

  await $.session.start({ cwd: '/w/web', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'dash', args: '' })
  await new Promise(resolve => setTimeout(resolve, 300))

  const ui = await $.ui.mount({ plugin: 'dev-dash', surface: 'terminal', ...PANE })
  const has = async (re: RegExp) => {
    if (!(await ui.find({ type: 'Text', text: re }))) throw new Error(`no text matching ${re}`)
  }
  await has(/Plan \(1\)/)
  await has(/2\/5/)
  await has(/↳ Writing the login form/)
  await has(/Sources \(2\)/)
  await has(/example\.com\/docs\/auth/)
  await has(/oauth device flow/)
  await has(/Files \(3\)/)
  await has(/\+52/)
  await has(/login\.ts/)
  await has(/README\.md/)
  await has(/edited/)
  expect(await ui.find({ type: 'Text', text: /README\.md.*\+0/ })).toBeUndefined()
  await ui.unmount()
})

test('finds git and gh in their install folders when the process PATH does not have them', { timeoutMs: 15_000 }, async ($, on) => {
  const now = Date.now()
  const called: string[] = []
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'self' }))
  on('session.cwd', async () => ({ value: '/w/web' }))
  on('session.usage', async () => ({ value: { startedAt: now - 60_000, context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 0.1 } } }))
  on('env.get', async (_$, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : e.name === 'OS' ? 'Windows_NT' : e.name === 'ProgramFiles' ? 'C:\\Program Files' : undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('clock.every', async () => ({ value: undefined }))
  on('ui.open', async (_$, e) => ({ value: { id: e.id } }))
  on('ui.close', async () => ({ value: undefined }))
  // Only the full install paths work: plain `git` and `gh` are "not found", as in a process with an old PATH.
  on('process.run', async (_$, e) => {
    called.push(e.argv[0])
    if (e.argv[0] === 'git' || e.argv[0] === 'gh') throw new Error('spawn ENOENT')
    if (e.argv[0].endsWith('git.exe')) return ok('main\n')
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', async () => ({ value: undefined }))
  on('fs.list', async () => ({ value: [] }))
  on('fs.stat', async () => {
    throw new Error('ENOENT')
  })
  on('fs.read', async () => ({ value: '' }))

  await $.session.start({ cwd: '/w/web', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'dash', args: '' })
  await new Promise(resolve => setTimeout(resolve, 300))

  expect(called.some(c => c.endsWith('git.exe'))).toBe(true)
  expect(called.some(c => c.endsWith('gh.exe'))).toBe(true)
})

test('summaries: off by default, on writes a one-line label after a finished turn', { timeoutMs: 15_000 }, async ($, on) => {
  const now = Date.now()
  const files = new Map<string, string>([
    ['/cfg/sessions/100.json', JSON.stringify({ pid: 100, sessionId: 'self', cwd: '/w/web', startedAt: now - 60_000, name: 'web work', entrypoint: 'cli', status: 'busy' })],
  ])
  const prompts: string[] = []
  const store = new Map<string, unknown>()
  const none = { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  const unify = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('turn.complete', async () => ({ text: '' }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'self' }))
  on('session.cwd', async () => ({ value: '/w/web' }))
  on('session.usage', async () => ({ value: { startedAt: now - 60_000, context: { window: 200_000, percent: 40 }, rateLimits: [], cost: { usd: 0.1 } } }))
  on('env.get', async (_$, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('clock.every', async () => ({ value: undefined }))
  on('ui.open', async (_$, e) => ({ value: { id: e.id } }))
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('process.run', async (_$, e) => ({ value: e.argv[0] === 'tasklist' ? { exitCode: 0, stdout: '"claude.exe","100","Console","5","1 K"\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } : none.value }))
  on('fs.write', async (_$, e) => {
    files.set(unify(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', async (_$, e) => {
    const dir = `${unify(e.path)}/`
    const names = [...files.keys()].filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file' as const, size: 1, mtimeMs: now, isLink: false })) }
  })
  on('fs.stat', async () => {
    throw new Error('ENOENT')
  })
  on('fs.read', async (_$, e) => ({ value: files.get(unify(e.path)) ?? '' }))
  on('model.complete', async (_$, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: '"Fixing the login redirect bug."', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })

  await $.session.start({ cwd: '/w/web', surface: 'terminal', isInteractive: true })

  // Off by default: a finished turn makes no model call.
  await $.prompt.submit({ text: 'fix the login redirect' })
  const done = { answer: 'Changed auth.ts to keep the query string.', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' } as const
  await $.turn.complete(done as never)
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(prompts.length).toBe(0)

  const on1 = await $.command.run({ command: 'dash-summaries', args: 'on' })
  expect(on1.text).toMatch(/summaries on/i)
  await $.prompt.submit({ text: 'fix the login redirect' })
  await $.turn.complete(done as never)
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Request: fix the login redirect')
  expect(prompts[0]).toContain('Changed auth.ts')
  const beat = JSON.parse(files.get('/cfg/dev-dash/sessions/self.json') ?? '{}') as { summary?: string }
  expect(beat.summary).toBe('Fixing the login redirect bug')

  await $.command.run({ command: 'dash', args: '' })
  await new Promise(resolve => setTimeout(resolve, 300))
  const ui = await $.ui.mount({
    plugin: 'dev-dash',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'dev-dash',
    viewport: { columns: 80, rows: 40 },
    props: { title: 'Dev dashboard', isFocused: false, bodyColumns: 78, placement: 'dock' },
  })
  if (!(await ui.find({ type: 'Text', text: /↳ Fixing the login redirect bug/ }))) throw new Error('summary not drawn')
  await ui.unmount()

  await $.command.run({ command: 'dash-summaries', args: 'off' })
  expect(JSON.parse(files.get('/cfg/dev-dash/sessions/self.json') ?? '{}').summary).toBe('')
})

test('draws each watch as an outlined box with the GitHub icon and status marks; /dash-icons switches the icon', { timeoutMs: 15_000 }, async ($, on) => {
  const now = Date.now()
  const base = { addedAt: now - 60_000, expiresAt: now + 3_600_000, changedAt: now - 30_000, done: false, value: 'x', checkedAt: now - 20_000, firedAt: 0, fired: '', title: '' }
  const watches = [
    { ...base, id: 'pr:o/r#11', kind: 'pr', repo: 'o/r', number: 11, title: 'Test badge on each session row', detail: 'ready to merge', tone: 'ok', firedAt: now - 5_000, fired: 'ready to merge', chips: [{ icon: '✔', text: 'ready', tone: 'ok' }, { icon: '●', text: 'CI', tone: 'ok' }, { icon: '✔', text: 'approved', tone: 'ok' }] },
    { ...base, id: 'issue:o/r#4', kind: 'issue', repo: 'o/r', number: 4, title: 'Crash on start', detail: 'open', tone: 'info', chips: [{ icon: '○', text: 'open', tone: 'ok' }, { icon: '💬', text: '2', tone: 'info' }] },
    { ...base, id: 'run:o/r#99', kind: 'run', repo: 'o/r', number: 99, title: 'CI · main', detail: 'failed', tone: 'bad', chips: [{ icon: '✗', text: 'failed', tone: 'bad' }] },
    // Saved before the boxes existed: no marks yet, so it says it is waiting rather than drawing nothing.
    { id: 'pr:o/r#2', kind: 'pr', repo: 'o/r', number: 2, title: 'Old row', addedAt: now, expiresAt: now + 3_600_000, value: '', detail: '', checkedAt: 0, changedAt: 0, firedAt: 0, fired: '', done: false },
  ]
  const store = new Map<string, unknown>([['watches', watches]])
  const none = { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'self' }))
  on('session.cwd', async () => ({ value: '/w/web' }))
  on('session.usage', async () => ({ value: { startedAt: now - 60_000, context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 0.1 } } }))
  on('env.get', async (_$, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('clock.every', async () => ({ value: undefined }))
  on('ui.open', async (_$, e) => ({ value: { id: e.id } }))
  on('ui.close', async () => ({ value: undefined }))
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('process.run', async () => none)
  on('fs.write', async () => ({ value: undefined }))
  on('fs.list', async () => ({ value: [] }))
  on('fs.stat', async () => {
    throw new Error('ENOENT')
  })
  on('fs.read', async () => ({ value: '' }))

  await $.session.start({ cwd: '/w/web', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'dash', args: '' })
  await new Promise(resolve => setTimeout(resolve, 300))

  const seen = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<unknown> }, re: RegExp) => !!(await ui.find({ type: 'Text', text: re }))
  const ui = await $.ui.mount({ plugin: 'dev-dash', surface: 'terminal', ...PANE })
  for (const re of [/Watching \(4 · 1 fired\)/, /PR #11/, /Issue #4/, /Run #99/, /Test badge on each session row/, /Crash on start/, /✔ ready/, /💬 2/, /✗ failed/, /waiting for the first look/, /◆ ready to merge/]) {
    if (!(await seen(ui, re))) throw new Error(`no text matching ${re}`)
  }
  // The default is the emoji icon, which every font has; the official mark is opt-in.
  if (!(await seen(ui, /🐙/))) throw new Error('no GitHub emoji by default')
  expect(await seen(ui, /\uf09b/)).toBe(false)
  await ui.unmount()

  // /dash-icons lists the styles, refuses one it does not know, and changes and remembers a good one.
  expect(JSON.stringify(await $.command.run({ command: 'dash-icons', args: '' }))).toContain('emoji | nerd | ascii')
  await $.command.run({ command: 'dash-icons', args: 'fancy' })
  expect(store.has('iconStyle')).toBe(false)
  await $.command.run({ command: 'dash-icons', args: 'nerd' })
  expect(store.get('iconStyle')).toBe('nerd')
  const nerd = await $.ui.mount({ plugin: 'dev-dash', surface: 'terminal', ...PANE })
  if (!(await seen(nerd, /\uf09b/))) throw new Error('no Nerd Font GitHub mark after /dash-icons nerd')
  expect(await seen(nerd, /🐙/)).toBe(false)
  await nerd.unmount()
  await $.command.run({ command: 'dash-icons', args: 'ascii' })
  const ascii = await $.ui.mount({ plugin: 'dev-dash', surface: 'terminal', ...PANE })
  if (!(await seen(ascii, /GH/))) throw new Error('no ascii GH after /dash-icons ascii')
  await ascii.unmount()
})
