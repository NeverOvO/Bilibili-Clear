import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const tick = () => new Promise(resolve => setImmediate(resolve))
const load = (file: string, mocks: Record<string, unknown>, globals = {}, expose = '') => {
  const { outputText } = ts.transpileModule(`${readFileSync(file, 'utf8')}\n${expose}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} as any }
  vm.runInNewContext(
    outputText,
    {
      module,
      exports: module.exports,
      require: (name: string) => {
        if (!(name in mocks)) {
          throw new Error(`Unexpected dependency: ${name}`)
        }
        return mocks[name]
      },
      console: { error: () => undefined },
      AbortController,
      Event,
      ...globals,
    },
    { filename: file },
  )
  return module.exports
}

class ElementStub extends EventTarget {
  id = ''
  className = ''
  hidden = false
  textContent = ''
  parent: ElementStub | undefined
  children: ElementStub[] = []
  shadow: ElementStub | undefined
  attributes = new Map<string, string>()
  classes = new Set<string>()
  classList = {
    add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  }
  append(...children: ElementStub[]) {
    children.forEach(child => this.appendChild(child))
  }
  appendChild(child: ElementStub) {
    child.remove()
    child.parent = this
    this.children.push(child)
    return child
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(child => child !== this)
      this.parent = undefined
    }
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string) {
    this.attributes.delete(name)
  }
  attachShadow() {
    this.shadow = new ElementStub()
    return this.shadow
  }
  find(predicate: (element: ElementStub) => boolean): ElementStub | undefined {
    if (predicate(this)) {
      return this
    }
    return this.children.map(child => child.find(predicate)).find(Boolean)
  }
}

const browser = () => {
  const root = new ElementStub()
  const head = root.appendChild(new ElementStub())
  const body = root.appendChild(new ElementStub())
  const document = Object.assign(new EventTarget(), {
    documentElement: root as ElementStub | null,
    head,
    body: body as ElementStub | null,
    readyState: 'interactive',
    createElement: () => new ElementStub(),
    createDocumentFragment: () => new ElementStub(),
    getElementById: (id: string) => root.find(element => element.id === id),
    querySelector: () => null,
  })
  let sequence = 0
  const timers = new Map<number, { callback: () => void; delay: number }>()
  const frames = new Map<number, () => void>()
  const window = Object.assign(new EventTarget(), {
    top: 1,
    self: 1,
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++sequence
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: (id: number) => timers.delete(id),
    requestAnimationFrame: (callback: () => void) => {
      const id = ++sequence
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })
  const runTimer = (delay: number) => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay)
    assert.ok(entry, `Missing ${delay} ms timer`)
    timers.delete(entry[0])
    entry[1].callback()
  }
  const location = { hostname: 'www.bilibili.com', pathname: '/' }
  return { root, document, window, timers, frames, runTimer, location }
}

const noDiagnostics = {
  recordHomeStartup: () => undefined,
  recordHomeGuardFrame: () => undefined,
  finishHomeStartupDiagnostics: () => undefined,
}

test('release diagnostics do not read browser state, collect records, or schedule work', () => {
  const unexpected = () => assert.fail('Release diagnostics must remain inactive')
  const api = load(
    'src/client/clear-home-diagnostics.ts',
    { './clear-home-diagnostics.scss': { default: '' } },
    {
      webpackGitInfo: { branch: 'master' },
      window: { setTimeout: unexpected, requestAnimationFrame: unexpected },
      performance: { now: unexpected },
    },
    'exports.inspect = () => ({ started, count: records.length, host })',
  )
  api.startHomeStartupDiagnostics()
  api.recordHomeStartup('should not collect')
  api.recordHomeGuardFrame({})
  api.finishHomeStartupDiagnostics()
  assert.equal(api.inspect().started, false)
  assert.equal(api.inspect().count, 0)
  assert.equal(api.inspect().host, undefined)
})

test('beta diagnostics cap records and close clears timers, frames and event collection', () => {
  const h = browser()
  const api = load(
    'src/client/clear-home-diagnostics.ts',
    { './clear-home-diagnostics.scss': { default: '' } },
    {
      ...h,
      webpackGitInfo: { branch: 'beta' },
      performance: { now: () => 500, getEntriesByType: () => [] },
    },
    'exports.inspect = () => ({ count: records.length, capped })',
  )
  api.startHomeStartupDiagnostics()
  h.runTimer(0)
  assert.ok(h.document.getElementById('bilibili-clear-startup-diagnostics'))
  api.recordHomeGuardFrame({ isConnected: false })
  api.finishHomeStartupDiagnostics()
  const host = h.document.getElementById('bilibili-clear-startup-diagnostics')
  host.shadow.find(element => element.textContent === '关闭').dispatchEvent(new Event('click'))
  const before = api.inspect().count
  h.document.dispatchEvent(new Event('DOMContentLoaded'))
  h.window.dispatchEvent(new Event('load'))
  api.recordHomeStartup('closed')
  assert.equal(api.inspect().count, before)
  assert.equal(h.timers.size, 0)
  assert.equal(h.frames.size, 0)
  assert.equal(h.document.getElementById('bilibili-clear-startup-diagnostics'), undefined)

  const cap = load(
    'src/client/clear-home-diagnostics.ts',
    { './clear-home-diagnostics.scss': { default: '' } },
    {
      ...browser(),
      webpackGitInfo: { branch: 'beta' },
      performance: { now: () => 500, getEntriesByType: () => [] },
    },
    'exports.inspect = () => ({ count: records.length, capped })',
  )
  cap.startHomeStartupDiagnostics()
  for (let index = 0; index < 150; index++) {
    cap.recordHomeStartup('bounded')
  }
  assert.equal(cap.inspect().count, 100)
  assert.equal(cap.inspect().capped, true)
})

test('beta diagnostics collapse removes the body from layout and can expand without remounting', () => {
  const h = browser()
  const api = load(
    'src/client/clear-home-diagnostics.ts',
    { './clear-home-diagnostics.scss': { default: '' } },
    {
      ...h,
      webpackGitInfo: { branch: 'beta' },
      performance: { now: () => 500, getEntriesByType: () => [] },
    },
  )
  api.startHomeStartupDiagnostics()
  h.runTimer(0)
  const host = h.document.getElementById('bilibili-clear-startup-diagnostics')
  const toggle = host.shadow.find(element => element.textContent === '收起')
  const body = host.shadow.find(element => element.className === 'panel-body')
  toggle.dispatchEvent(new Event('click'))
  assert.equal(body.hidden, true)
  assert.equal(toggle.attributes.get('aria-expanded'), 'false')
  assert.equal(toggle.textContent, '展开')
  toggle.dispatchEvent(new Event('click'))
  assert.equal(body.hidden, false)
  assert.equal(toggle.attributes.get('aria-expanded'), 'true')
  assert.equal(h.document.getElementById(host.id), host)
})

test('retired helper releases existing cover even when storage access is blocked', () => {
  const h = browser()
  h.root.classList.add('clear-home-preloading')
  h.root.setAttribute('data-clear-home-bypass', '1')
  const cover = h.root.appendChild(new ElementStub())
  cover.id = 'bilibili-clear-home-preloader'
  const trace = h.root.appendChild(new ElementStub())
  trace.id = 'bilibili-clear-home-preload-trace'
  const removedKeys: string[] = []
  let released = 0
  h.document.addEventListener('bilibili-clear-home-release', () => released++)
  const api = load(
    'src/client/retire-home-preloader.ts',
    {},
    {
      ...h,
      localStorage: {
        removeItem: (key: string) => {
          removedKeys.push(key)
          throw new Error('Storage blocked')
        },
      },
    },
  )
  api.retireHomePreloader()
  assert.equal(released, 1)
  assert.equal(h.root.classes.size, 0)
  assert.equal(h.root.attributes.get('data-clear-home-core-state'), 'released')
  assert.equal(h.document.getElementById(cover.id), undefined)
  assert.equal(h.document.getElementById(trace.id), undefined)
  assert.deepEqual(removedKeys, ['bilibili-clear:following-home-until:v1'])
  h.window.top = 2
  api.retireHomePreloader()
  assert.equal(removedKeys.length, 1)
})

test('homepage guard uses migrated settings precedence and Escape keeps saved mode untouched', () => {
  const h = browser()
  const saved = {
    schemaVersion: 1,
    components: { clearHome: { enabled: true, options: { mode: '关注极简' } } },
    userComponents: {
      clearHome: { settings: { enabled: true, options: { mode: '原版精简' } } },
    },
  }
  const api = load(
    'src/client/clear-home-bootstrap.ts',
    {
      './clear-home-bootstrap.scss': { default: '' },
      '../ui/clear/project-mark.svg?inline': { default: '' },
      './clear-home-diagnostics': noDiagnostics,
    },
    { ...h, GM_getValue: (key: string) => saved[key] },
  )
  api.startClearHomeBootstrap()
  assert.equal(h.root.classList.contains('clear-home-booting'), true)
  const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })
  h.window.dispatchEvent(escape)
  assert.equal(escape.defaultPrevented, true)
  assert.equal(api.isClearHomeBootstrapBypassed(), true)
  assert.equal(h.root.classList.contains('clear-home-booting'), false)
  assert.equal(h.timers.size, 0)
  assert.equal(saved.components.clearHome.options.mode, '关注极简')
})

test('a staged original-mode import and unavailable settings never hide the native homepage', () => {
  for (const store of [
    (key: string) => {
      if (key === 'clearPendingSettingsImport') {
        return { components: { clearHome: { options: { mode: '原版精简' } } } }
      }
      return { clearHome: { enabled: true, options: { mode: '关注极简' } } }
    },
    () => {
      throw new Error('Storage unavailable')
    },
  ]) {
    const h = browser()
    const api = load(
      'src/client/clear-home-bootstrap.ts',
      {
        './clear-home-bootstrap.scss': { default: '' },
        '../ui/clear/project-mark.svg?inline': { default: '' },
        './clear-home-diagnostics': noDiagnostics,
      },
      { ...h, GM_getValue: store },
    )
    api.startClearHomeBootstrap()
    assert.equal(h.root.classes.size, 0)
    assert.equal(h.timers.size, 0)
    assert.equal(h.document.head.children.length, 0)
  }
})

test('a rejected core initialization releases the homepage guard', async () => {
  const cleanup: string[] = []
  load('src/client/bilibili-evolved.ts', {
    './init': { init: async () => Promise.reject(new Error('Unavailable runtime')) },
    './clear-home-bootstrap': {
      finishClearHomeBootstrap: (reason: string) => cleanup.push(reason),
    },
    './clear-home-diagnostics': {
      ...noDiagnostics,
      finishHomeStartupDiagnostics: () => cleanup.push('diagnostics finished'),
    },
  })
  await tick()
  assert.deepEqual(cleanup, ['启动异常', 'diagnostics finished'])
})

const deferred = () => {
  let resolve: (value: unknown) => void
  const promise = new Promise<unknown>(done => {
    resolve = done
  })
  return { promise, resolve }
}

const componentHarness = () => {
  const h = browser()
  let created = 0
  let destroyed = 0
  let tracking = 0
  let observerDisconnected = 0
  let route: () => void
  const readiness: (() => void)[] = []
  const mocks: Record<string, unknown> = {
    '@/components/define': { defineComponentMetadata: (value: unknown) => value },
    '@/core/life-cycle': { contentLoaded: (callback: () => void) => readiness.push(callback) },
    '@/core/observer': {
      childList: () => [{ disconnect: () => observerDisconnected++ }],
      urlChange: (callback: () => void) => {
        route = callback
        callback()
      },
    },
    '@/core/settings': {
      isComponentEnabled: () => true,
      getComponentSettings: () => ({ options: { mode: '关注极简' } }),
    },
    '@/core/style': {
      addStyle: (_text: string, id: string) => {
        const style = h.document.head.appendChild(new ElementStub())
        style.id = id
        return style
      },
    },
    '@/core/utils': {
      mountVueComponent: () => {
        created++
        h.root.classList.add('clear-following-active')
        return { $el: new ElementStub(), $destroy: () => destroyed++ }
      },
    },
    '@/client/clear-home-bootstrap': {
      finishClearHomeBootstrap: () => undefined,
      isClearHomeBootstrapBypassed: () => false,
    },
    '@/client/clear-home-diagnostics': noDiagnostics,
    './runtime': {
      getProgressStore: () => ({ startTracking: () => tracking++ }),
      releaseProgressStore: () => undefined,
    },
    './native-lottery': { startNativeLotteryBridge: () => undefined },
    './page-title': { markClearPageTitle: () => undefined },
    './home.scss': { default: '' },
    './shorts.scss': { default: '' },
    './ClearHome.vue': { default: {} },
  }
  const api = load('registry/lib/components/style/clear-home/index.ts', mocks, {
    ...h,
    componentsTags: { style: 'style', video: 'video' },
  })
  return {
    ...h,
    api,
    mocks,
    readiness,
    route: () => route(),
    counts: () => ({ created, destroyed, tracking, observerDisconnected }),
  }
}

test('early and normal homepage entries share one view and remove it on route departure', async () => {
  const h = componentHarness()
  h.api.prepareClearHome()
  h.api.component.entry()
  await tick()
  assert.equal(h.counts().created, 1)
  assert.equal(h.readiness.length, 1)
  h.readiness[0]()
  await tick()
  assert.equal(h.counts().tracking, 1)
  assert.equal(h.counts().created, 1)
  h.location.pathname = '/video/BV123'
  h.route()
  assert.equal(h.counts().destroyed, 1)
  assert.equal(h.root.classList.contains('clear-following-active'), false)
  h.api.component.unload()
  assert.equal(h.document.getElementById('clear-home-early'), undefined)
})

test('unload prevents pending imports from mounting or styling an obsolete homepage', async () => {
  const h = componentHarness()
  const pendingView = deferred()
  const pendingStyle = deferred()
  h.mocks['./ClearHome.vue'] = pendingView.promise
  h.mocks['./home.scss'] = pendingStyle.promise
  h.api.prepareClearHome()
  await tick()
  h.api.component.unload()
  pendingView.resolve({ default: {} })
  pendingStyle.resolve({ default: '' })
  await tick()
  h.readiness[0]()
  assert.equal(h.counts().created, 0)
  assert.equal(h.counts().tracking, 0)
  assert.equal(h.document.head.children.length, 0)
  h.api.component.reload()
  await tick()
  assert.equal(h.counts().created, 1)
  h.api.component.unload()
})

test('a failed early mount cancels late styles and the normal component entry can retry', async () => {
  const h = componentHarness()
  const lateStyle = deferred()
  Object.defineProperty(h.mocks, './ClearHome.vue', {
    configurable: true,
    get: () => {
      throw new Error('Module failed to initialize')
    },
  })
  h.mocks['./home.scss'] = lateStyle.promise
  h.api.prepareClearHome()
  await tick()
  lateStyle.resolve({ default: '' })
  await tick()
  assert.equal(h.counts().created, 0)
  assert.equal(h.document.head.children.length, 0)
  Object.defineProperty(h.mocks, './ClearHome.vue', { value: { default: {} } })
  h.api.component.entry()
  await tick()
  assert.equal(h.counts().created, 1)
  assert.equal(h.readiness.length, 1)
  h.api.component.unload()
})

test('unload disconnects an early body observer and prevents its deferred lifecycle work', async () => {
  const h = componentHarness()
  h.document.body = null
  h.api.prepareClearHome()
  h.api.component.unload()
  await tick()
  h.readiness[0]()
  assert.equal(h.counts().observerDisconnected, 1)
  assert.equal(h.counts().created, 0)
  assert.equal(h.counts().tracking, 0)
})
