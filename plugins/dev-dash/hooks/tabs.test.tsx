import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'dev-dash',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'dev-dash',
  viewport: { columns: 80, rows: 60 },
  props: { title: 'Dev dashboard', isFocused: true, bodyColumns: 78, placement: 'dock' },
} as const

test('tabs: Dashboard keeps everything, Entertainment shows Spotify and Stocks, Custom is empty', { timeoutMs: 20_000 }, async ($, on) => {
  const now = Date.now()
  const files = new Map<string, string>([
    ['/cfg/sessions/100.json', JSON.stringify({ pid: 100, sessionId: 'self', cwd: '/w/web', startedAt: now - 60_000, name: 'web work', entrypoint: 'cli', status: 'busy' })],
  ])
  const spotify: string[] = []
  const commands: string[][] = []
  const unify = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  const fail = { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'self' }))
  on('session.cwd', async () => ({ value: '/w/web' }))
  on('session.usage', async () => ({ value: { startedAt: now - 60_000, context: { window: 200_000, percent: 30 }, rateLimits: [], cost: { usd: 0.2 } } }))
  on('env.get', async (_$, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : e.name === 'OS' ? 'Windows_NT' : undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('clock.every', async () => ({ value: undefined }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.open', async (_$, e) => ({ value: { id: e.id } }))
  on('ui.close', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('process.run', async (_$, e) => {
    commands.push([...e.argv])
    if (e.argv[0] === 'tasklist') return out('"claude.exe","100","Console","5","1 K"\n')
    if (e.argv[0] === 'powershell' && /Spotify/.test(e.argv.join(' '))) return out(spotify[0] ?? '')
    return fail
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
  on('fs.stat', async () => {
    throw new Error('ENOENT')
  })
  on('fs.read', async (_$, e) => ({ value: files.get(unify(e.path)) ?? '' }))

  await $.session.start({ cwd: '/w/web', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'dash', args: '' })
  await new Promise(resolve => setTimeout(resolve, 300))

  const ui = await $.ui.mount(PANE as never)
  const has = async (re: RegExp) => !!(await ui.find({ type: 'Text', text: re }))
  const need = async (re: RegExp) => {
    if (!(await has(re))) throw new Error(`no text matching ${re}`)
  }
  const gone = async (re: RegExp) => {
    if (await has(re)) throw new Error(`text still showing: ${re}`)
  }
  const hasKey = async (key: string) => !!(await ui.find({ key }))
  const press = async (key: string) => {
    await ui.press({ key })
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const spotifyCalls = () => commands.filter(c => c[0] === 'powershell' && /Spotify/.test(c.join(' '))).length

  // Three tab buttons are always there, and Dashboard is the one showing: it has the sections it had before.
  for (const t of ['dashboard', 'entertainment', 'custom']) expect(await hasKey(`tab-${t}`)).toBe(true)
  await need(/Attention/)
  await need(/Sessions \(/)
  await need(/Monitor/)
  await gone(/Now playing/)
  await gone(/Stocks/)
  expect(spotifyCalls()).toBe(0)

  // Entertainment: the Dashboard sections go, the cards come, and Spotify is read (and only now).
  spotify.push('Daft Punk - Around the World\r\n')
  await press('tab-entertainment')
  await press('key-refresh')
  await need(/Now playing/)
  await need(/Daft Punk - Around the World/)
  await need(/Stocks/)
  await need(/Not set up/)
  await gone(/Sessions \(/)
  await gone(/Attention$/)
  expect(spotifyCalls()).toBeGreaterThan(0)
  // The footer and the tab bar stay.
  expect(await hasKey('key-help')).toBe(true)
  expect(await hasKey('tab-dashboard')).toBe(true)

  // Nothing playing is said plainly.
  spotify[0] = 'Spotify Premium'
  await new Promise(resolve => setTimeout(resolve, 4100))
  await press('key-refresh')
  await need(/nothing is playing/)

  // Custom: empty on purpose, and Spotify is not read while it is showing.
  await press('tab-custom')
  await need(/Nothing here yet/)
  await gone(/Now playing/)
  await gone(/Sessions \(/)
  const before = spotifyCalls()
  await new Promise(resolve => setTimeout(resolve, 4100))
  await press('key-refresh')
  expect(spotifyCalls()).toBe(before)

  // Back to Dashboard: everything returns.
  await press('tab-dashboard')
  await need(/Sessions \(/)
  await need(/Monitor/)
  await gone(/Nothing here yet/)

  await ui.unmount()
})
