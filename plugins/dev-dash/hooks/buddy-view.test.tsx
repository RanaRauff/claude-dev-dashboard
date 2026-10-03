import { expect, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'dev-dash', props: { title: 'Dev dashboard', isFocused: false } } as const

// A tiny sprite pack: a 3 x 2 orange block that walks, kicking up dust.
const PACK = JSON.stringify({
  v: 2,
  name: 'ember',
  palette: { O: '#f08838', K: '#303040' },
  mouth: [2, 0],
  moods: { idle: { motion: 'walk', fx: 'dust', ms: 200, frames: [['OKO', 'OOO']] } },
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a sprite buddy takes the beat's slot on the ${surface}`, { timeoutMs: 15_000 }, async ($, on) => {
    const store: Record<string, unknown> = { focusOn: false, beatStyle: 'buddy', buddyName: 'ember' }
    on('store.get', async (_$, e) => ({ value: store[e.key] }))
    on('store.set', async (_$, e) => {
      store[e.key] = e.value
      return { value: undefined }
    })
    on('ui.open', async (_$, e) => ({ value: { id: e.id } }))
    on('ui.close', async () => ({ value: undefined }))
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('fs.write', async () => ({ value: undefined }))
    on('fs.list', async () => ({ value: [] }))
    on('fs.read', async (_$, e) => ({ value: String(e.path).replace(/\\/g, '/').endsWith('/buddy/ember.json') ? PACK : '' }))

    await $.command.run({ command: 'dash', args: '' })
    const said = await $.command.run({ command: 'dash-beat', args: 'buddy ember' })
    expect(said.text).toMatch(/shows ember/)
    await new Promise(resolve => setTimeout(resolve, 300))
    const ui = await $.ui.mount({ plugin: 'dev-dash', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /♥ ember/ })).toBeDefined()
    const raster = await ui.find({ key: 'buddy' })
    if (surface === 'terminal') {
      // one Raster the size of the slot (5 rows), repainted in place by a timer
      expect(raster?.type).toBe('Raster')
      expect(raster?.props.rows).toBe(5)
    } else {
      // no Raster on this surface: the same scene as coloured half blocks in text
      expect(raster).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /[▀▄█]/ })).toBeDefined()
    }
    await ui.unmount()
  })
}
