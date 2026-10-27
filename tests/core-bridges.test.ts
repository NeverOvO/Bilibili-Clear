import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const tick = () => new Promise(resolve => setImmediate(resolve))
const load = (file: string, globals: Record<string, unknown>) => {
  const source = readFileSync(file, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} as any }
  vm.runInNewContext(
    outputText,
    { module, exports: module.exports, ...globals },
    { filename: file },
  )
  return module.exports
}

const storageHarness = () => {
  let receive: (event: any) => void
  let sequence = 0
  const sent: any[] = []
  const timers = new Map<number, () => void>()
  const frame = { postMessage: (message: any) => sent.push(message) }
  let select = async (): Promise<any> => ({ contentWindow: frame })
  const api = load('src/core/local-storage.ts', {
    window: {
      addEventListener: (_: string, callback: typeof receive) => {
        receive = callback
      },
    },
    setTimeout: (callback: () => void) => {
      const id = ++sequence
      timers.set(id, callback)
      return id
    },
    clearTimeout: (id: number) => timers.delete(id),
    require: (name: string) =>
      name === './spin-query'
        ? { select: () => select() }
        : {
            getRandomId: () => `request-${++sequence}`,
            deleteValue: (items: any[], predicate: (item: any) => boolean) => {
              const index = items.findIndex(predicate)
              if (index >= 0) {
                items.splice(index, 1)
              }
            },
          },
  }).crossOriginLocalStorage
  return {
    api,
    sent,
    frame,
    timers,
    select: (callback: typeof select) => {
      select = callback
    },
    receive: (event: any) => receive(event),
    expire: () => {
      ;[...timers.values()].forEach(callback => callback())
      timers.clear()
    },
  }
}

test('importing an advertised JSON file never executes JavaScript expressions', async () => {
  let input = '{"safe":true}'
  const marker = { executed: false }
  const api = load('src/core/external-input/index.ts', {
    console: { error: () => undefined },
    marker,
    require: (name: string) =>
      name === '@/core/file-picker' ? { pickFile: async () => [{ text: async () => input }] } : {},
  })
  assert.equal((await api.parseExternalInput()).safe, true)
  input = '(marker.executed = true, {safe: false})'
  assert.equal(await api.parseExternalInput(), null)
  assert.equal(marker.executed, false)
})

test('cross-origin storage accepts replies only from the selected official frame', async () => {
  const h = storageHarness()
  let settled = false
  const promise = h.api.getItem('search_history').then((value: unknown) => {
    settled = true
    return value
  })
  await tick()
  const data = { type: 'COLS_RES', id: h.sent[0].id, value: 'history' }
  h.receive({ data: null, origin: 'https://s1.hdslb.com', source: h.frame })
  h.receive({ data, origin: 'https://evil.example', source: h.frame })
  h.receive({ data, origin: 'https://s1.hdslb.com', source: {} })
  await tick()
  assert.equal(settled, false)
  h.receive({ data, origin: 'https://s1.hdslb.com', source: h.frame })
  assert.equal(await promise, 'history')
  assert.equal(h.timers.size, 0)
})

test('missing storage frames reject promptly and expired writes are never sent late', async () => {
  const missing = storageHarness()
  missing.select(async () => null)
  await assert.rejects(missing.api.keys('test'), /iframe not found/)
  assert.equal(missing.timers.size, 0)
  const h = storageHarness()
  let ready: (frame: unknown) => void
  h.select(
    () =>
      new Promise(resolve => {
        ready = resolve
      }),
  )
  const pending = assert.rejects(h.api.setItem('key', 'value'), /timed out/)
  h.expire()
  await pending
  ready({ contentWindow: h.frame })
  await tick()
  assert.equal(h.sent.length, 0)
})

test('storage listener registration failure removes the listener and its timeout', async () => {
  const h = storageHarness()
  h.select(async () => {
    throw new Error('frame gone')
  })
  await assert.rejects(
    h.api.addStorageListener('key', () => assert.fail('stale callback')),
    /frame gone/,
  )
  assert.equal(h.timers.size, 0)
})

test('page title preserves native words and counters through SPA transitions and cleanup', () => {
  const api = load('src/core/page-title.ts', {})
  const target = { title: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili' }
  const original = target.title
  api.appendClearPageTitle(target)
  assert.equal(target.title, `${original} Clear`)
  api.appendClearPageTitle(target)
  assert.equal(api.getOriginalPageTitle(target), original)
  target.title = `(2) ${target.title}`
  api.appendClearPageTitle(target)
  assert.equal(target.title, `(2) ${original} Clear`)
  target.title = target.title.replace('(2)', '(3)')
  api.appendClearPageTitle(target)
  assert.equal(target.title, `(3) ${original} Clear`)
  target.title = 'New video called Clear'
  api.appendClearPageTitle(target)
  assert.equal(target.title, 'New video called Clear Clear')
  api.restoreOriginalPageTitle(target)
  assert.equal(target.title, 'New video called Clear')
  target.title = ''
  api.appendClearPageTitle(target)
  assert.equal(target.title, '')
})

test('early homepage guard fails open and cancels pending document attachment', () => {
  const classes = new Set<string>()
  let sequence = 0
  const timers = new Map<number, { callback: () => void; delay: number }>()
  const root = {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
  }
  const target: any = {
    documentElement: root,
    head: { appendChild: () => undefined },
    createElement: () => ({ remove: () => undefined }),
  }
  const windowMock = {
    top: 1,
    self: 1,
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++sequence
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: (id: number) => timers.delete(id),
  }
  const api = load('src/client/clear-home-bootstrap.ts', {
    document: target,
    window: windowMock,
    location: { hostname: 'www.bilibili.com', pathname: '/' },
    GM_getValue: () => ({ clearHome: { enabled: true, options: { mode: '关注极简' } } }),
    require: () => ({ default: '/* guard */' }),
  })
  api.startClearHomeBootstrap()
  assert.equal(classes.has('clear-home-booting'), true)
  const timeout = [...timers.values()].find(item => item.delay === 9000)
  assert.ok(timeout)
  timeout.callback()
  assert.equal(classes.size, 0)
  assert.equal(timers.size, 0)
  target.documentElement = null
  api.startClearHomeBootstrap()
  const lateAttach = [...timers.values()].find(item => item.delay === 0).callback
  api.finishClearHomeBootstrap()
  target.documentElement = root
  lateAttach()
  assert.equal(classes.size, 0)
  assert.equal(timers.size, 0)
})

test('distribution metadata shares one update channel and version exceeds the previous beta', () => {
  const common = JSON.parse(readFileSync('src/client/common.meta.json', 'utf8'))
  const manifest = JSON.parse(readFileSync('src/core/distribution-manifest.json', 'utf8'))
  const { Version } = load('src/core/version.ts', { require: () => ({}) })
  assert.equal(new Version(common.version).greaterThan(new Version('3.2.0.11')), true)
  assert.ok(['master', 'beta'].includes(manifest.branch))
  for (const file of [
    'src/client/bilibili-evolved.meta.json',
    'src/client/bilibili-evolved.preview.meta.json',
  ]) {
    const metadata = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(
      metadata.updateURL,
      `https://raw.githubusercontent.com/NeverOvO/Bilibili-Clear/${manifest.branch}/dist/bilibili-clear.user.js`,
    )
    assert.equal(metadata.downloadURL, metadata.updateURL)
  }
  assert.ok(common.icon.includes(`/Bilibili-Clear/${manifest.branch}/`))
  assert.ok(common.icon64.includes(`/Bilibili-Clear/${manifest.branch}/`))
})
