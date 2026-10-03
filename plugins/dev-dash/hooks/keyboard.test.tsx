import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'dev-dash',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'dev-dash',
  viewport: { columns: 80, rows: 50 },
  props: { title: 'Dev dashboard', isFocused: true, bodyColumns: 78, placement: 'dock' },
} as const

test('keyboard: rows open with Enter, actions copy, snooze and dismiss, footer buttons work, no letter keys', { timeoutMs: 20_000 }, async ($, on) => {
  const now = Date.now()
  const waitedSince = now - 180_000
  const waitId = `wait:wait1:${waitedSince}`
  const files = new Map<string, string>([
    ['/cfg/sessions/100.json', JSON.stringify({ pid: 100, sessionId: 'self', cwd: '/w/web', startedAt: now - 60_000, name: 'web work', entrypoint: 'cli', status: 'busy' })],
    ['/cfg/sessions/200.json', JSON.stringify({ pid: 200, sessionId: 'wait1', cwd: '/w/api', startedAt: now - 120_000, name: 'Fix flaky tests', entrypoint: 'cli', status: 'waiting', waitingFor: 'input needed', statusUpdatedAt: waitedSince })],
    ['/cfg/sessions/300.json', JSON.stringify({ pid: 300, sessionId: 'idle1', cwd: '/w/docs', startedAt: now - 600_000, name: 'Docs', entrypoint: 'cli', status: 'idle', statusUpdatedAt: now - 300_000 })],
  ])
  const copied: string[] = []
  const opened: Array<{ id: string; focus?: boolean }> = []
  const toasts: string[] = []
  const closed: string[] = []
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
  on('store.get', async (_$, e) => ({ value: e.key === 'focusOn' ? false : undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.open', async (_$, e) => {
    opened.push({ id: e.id, focus: e.focus })
    return { value: { id: e.id } }
  })
  on('ui.close', async (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
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
  const hasKey = async (key: string) => !!(await ui.find({ key }))

  // Every row has a marker button as its stop for Tab and the arrows; the whole-pane buttons are in the footer.
  expect(await hasKey(`pick-${waitId}`)).toBe(true)
  expect(await hasKey('pick-s:wait1')).toBe(true)
  for (const key of ['key-refresh', 'key-alerts', 'key-help', 'key-close']) expect(await hasKey(key)).toBe(true)
  // No letter hotkeys any more: nothing in the pane is armed by a letter.
  for (const key of ['key-down', 'key-up', 'key-top', 'key-copy', 'key-snooze', 'key-dismiss', 'key-undo']) expect(await hasKey(key)).toBe(false)

  // Enter on a row opens its actions, and Enter again closes them.
  expect(await hasKey(`act-copy-${waitId}`)).toBe(false)
  await press(`pick-${waitId}`)
  for (const a of ['copy', 'snooze', 'dismiss']) expect(await hasKey(`act-${a}-${waitId}`)).toBe(true)
  await press(`pick-${waitId}`)
  expect(await hasKey(`act-copy-${waitId}`)).toBe(false)

  // Copy: a resume command for the session. The actions close after use.
  await press(`pick-${waitId}`)
  await press(`act-copy-${waitId}`)
  expect(copied.pop()).toBe('claude --resume wait1')
  expect(toasts.pop()).toMatch(/Copied the resume command/)
  expect(await hasKey(`act-copy-${waitId}`)).toBe(false)

  // A Sessions row can only be copied: no snooze or dismiss on it.
  await press('pick-s:self')
  expect(await hasKey('act-copy-s:self')).toBe(true)
  expect(await hasKey('act-snooze-s:self')).toBe(false)
  expect(await hasKey('act-dismiss-s:self')).toBe(false)
  await press('act-copy-s:self')
  expect(copied.pop()).toBe('claude --resume self')

  // Flight Deck focus card: the first thing that needs you grows into a card with its actions and "1 of N".
  await need(/waiting on you/)
  await need(/^“input needed”$/)
  expect(await hasKey(`focus-copy`)).toBe(true)
  expect(await hasKey(`focus-snooze`)).toBe(true)
  await press('focus-snooze')
  if (await has(/waiting on you/)) throw new Error('the focus card still shows a snoozed session')
  await need(/nothing needs you/)
  await press('act-undo')
  await need(/waiting on you/)

  // Snooze hides the Attention row and says so; the button brings it back.
  await press(`pick-${waitId}`)
  await press(`act-snooze-${waitId}`)
  expect(toasts.pop()).toMatch(/Snoozed for 15 minutes/)
  if (await has(/◆ Fix flaky tests/)) throw new Error('the snoozed row is still in Attention')
  await need(/\+1 snoozed or dismissed/)
  await press('act-undo')
  await need(/◆ Fix flaky tests/)

  // Dismiss hides it until it changes; the same button brings it back.
  await press(`pick-${waitId}`)
  await press(`act-dismiss-${waitId}`)
  expect(toasts.pop()).toMatch(/Dismissed/)
  if (await has(/◆ Fix flaky tests/)) throw new Error('the dismissed row is still in Attention')
  await press('act-undo')

  // Help explains the generic keys.
  await press('key-help')
  await need(/^Keys$/)
  await need(/Enter/)
  await need(/ctrl\+x tab/)
  await press('key-help')
  if (await has(/^Keys$/)) throw new Error('help did not close')

  // The footer buttons work: alerts and refresh answer, close closes the pane.
  const alertsOff = await $.command.run({ command: 'dash-alerts', args: 'off' })
  expect(alertsOff.text).toBe('Dashboard alerts off.')
  await press('key-alerts')
  await press('key-refresh')
  await press('key-close')
  expect(closed).toContain('dev-dash')

  await ui.unmount()
})
