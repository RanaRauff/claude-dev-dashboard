import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'dev-dash',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'dev-dash',
  viewport: { columns: 80, rows: 50 },
  props: { title: 'Dev dashboard', isFocused: true, bodyColumns: 78, placement: 'dock' },
} as const

test('keys: /dash opens with the keyboard, j/k move, c copies, s and x mute, u undoes, h shows help', { timeoutMs: 20_000 }, async ($, on) => {
  const now = Date.now()
  const files = new Map<string, string>([
    ['/cfg/sessions/100.json', JSON.stringify({ pid: 100, sessionId: 'self', cwd: '/w/web', startedAt: now - 60_000, name: 'web work', entrypoint: 'cli', status: 'busy' })],
    ['/cfg/sessions/200.json', JSON.stringify({ pid: 200, sessionId: 'wait1', cwd: '/w/api', startedAt: now - 120_000, name: 'Fix flaky tests', entrypoint: 'cli', status: 'waiting', waitingFor: 'input needed', statusUpdatedAt: now - 180_000 })],
    ['/cfg/sessions/300.json', JSON.stringify({ pid: 300, sessionId: 'idle1', cwd: '/w/docs', startedAt: now - 600_000, name: 'Docs', entrypoint: 'cli', status: 'idle', statusUpdatedAt: now - 300_000 })],
  ])
  const copied: string[] = []
  const opened: Array<{ id: string; focus?: boolean }> = []
  const toasts: string[] = []
  const unify = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const fail = { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }

  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'self' }))
  on('session.cwd', async () => ({ value: '/w/web' }))
  on('session.usage', async () => ({ value: { startedAt: now - 60_000, context: { window: 200_000, percent: 30 }, rateLimits: [], cost: { usd: 0.2 } } }))
  on('env.get', async (_$, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('clock.every', async () => ({ value: undefined }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.open', async (_$, e) => {
    opened.push({ id: e.id, focus: e.focus })
    return { value: { id: e.id } }
  })
  on('ui.close', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.copy', async (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('process.run', async (_$, e) => (e.argv[0] === 'tasklist' ? ok('"claude.exe","100","Console","5","1 K"\n"claude.exe","200","Console","5","1 K"\n"claude.exe","300","Console","5","1 K"\n') : fail))
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
  expect(opened.find(o => o.id === 'dev-dash')?.focus).toBe(true)

  const ui = await $.ui.mount(PANE as never)
  const has = async (re: RegExp) => !!(await ui.find({ type: 'Text', text: re }))
  const need = async (re: RegExp) => {
    if (!(await has(re))) throw new Error(`no text matching ${re}`)
  }
  const press = async (key: string) => {
    await ui.press({ key })
    await new Promise(resolve => setTimeout(resolve, 80))
  }

  // The legend: one Button per key, each drawn on screen.
  for (const key of ['down', 'up', 'top', 'copy', 'snooze', 'dismiss', 'undo', 'refresh', 'alerts', 'help', 'close']) {
    if (!(await ui.find({ key: `key-${key}` }))) throw new Error(`no legend button for ${key}`)
  }

  // The cursor starts on the first row, the waiting item in Attention. c copies the session's resume command.
  await need(/◆ Fix flaky tests/)
  await press('key-copy')
  expect(copied.pop()).toBe('claude --resume wait1')
  expect(toasts.pop()).toMatch(/Copied the resume command/)

  // j moves down: Attention, then Sessions in the order drawn (waiting, running, idle).
  await press('key-down')
  await press('key-down')
  await press('key-copy')
  expect(copied.pop()).toBe('claude --resume self')
  await press('key-up')
  await press('key-copy')
  expect(copied.pop()).toBe('claude --resume wait1')
  await press('key-down')
  await press('key-down')
  await press('key-top')
  await press('key-copy')
  expect(copied.pop()).toBe('claude --resume wait1')

  // s on an Attention row hides it and says so; on a Sessions row it only explains.
  await press('key-snooze')
  expect(toasts.pop()).toMatch(/Snoozed for 15 minutes/)
  if (await has(/◆ Fix flaky tests/)) throw new Error('the snoozed row is still in Attention')
  await need(/\+1 snoozed or dismissed/)
  await press('key-snooze')
  expect(toasts.pop()).toMatch(/Only Attention items/)

  // u brings it back.
  await press('key-undo')
  await need(/◆ Fix flaky tests/)

  // x hides it until it changes; u brings it back again.
  await press('key-top')
  await press('key-dismiss')
  expect(toasts.pop()).toMatch(/Dismissed/)
  if (await has(/◆ Fix flaky tests/)) throw new Error('the dismissed row is still in Attention')
  await press('key-undo')

  // h shows the key list, and h again hides it.
  await press('key-help')
  await need(/^Keys$/)
  await need(/hide the selected Attention item for 15 minutes/)
  await press('key-help')
  if (await has(/^Keys$/)) throw new Error('help did not close')

  await ui.unmount()
})
