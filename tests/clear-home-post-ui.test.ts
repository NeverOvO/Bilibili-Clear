import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const componentSource = (file: string) =>
  readFileSync(path.join(root, 'registry/lib/components/style/clear-home', file), 'utf8').match(
    /<script[^>]*>([\s\S]*?)<\/script>/,
  )[1]
const load = (file: string, globals = {}) => {
  const { outputText } = ts.transpileModule(componentSource(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} as any }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: () => ({}),
    URL,
    HTMLElement: class HTMLElement {},
    Set,
    Map,
    console,
    ...globals,
  })
  return module.exports.default
}
const stateFor = (component: any, props = {}) => {
  const state: any = { ...props }
  component.beforeCreate?.call(state)
  Object.assign(state, component.data.call(state))
  for (const [name, method] of Object.entries(component.methods)) {
    state[name] = (method as (...args: any[]) => any).bind(state)
  }
  for (const [name, getter] of Object.entries(component.computed ?? {})) {
    Object.defineProperty(state, name, { get: (getter as (...args: any[]) => any).bind(state) })
  }
  state.$set = (target: any, key: string, value: any) => {
    target[key] = value
  }
  state.$delete = (target: any, key: string) => {
    delete target[key]
  }
  state.$emit = () => undefined
  state.$nextTick = (fn: () => void) => fn()
  return state
}
const post = (id: string, images: string[] = []) => ({
  id,
  text: '正文',
  title: '',
  images,
  imageSizes: {},
  author: { name: 'UP', id: '123' },
})
const previewHarness = () => {
  const timers = new Map<number, () => void>()
  let timerId = 0
  const component = load('PostDay.vue', {
    window: {
      innerHeight: 800,
      devicePixelRatio: 1,
      setTimeout: (callback: () => void) => {
        const handle = ++timerId
        timers.set(handle, callback)
        return handle
      },
    },
    clearTimeout: (handle: number) => timers.delete(handle),
    cancelAnimationFrame: () => undefined,
  })
  const makeState = (ids: string[]) => {
    const items = ids.map((id, index) => post(String(index), [`https://i0.hdslb.com/${id}.jpg`]))
    const state = stateFor(component, { active: true, group: { items }, detailStates: {} })
    items.forEach(item => {
      state.postRuntime.visibleImages.add({
        dataset: { imageUrl: item.images[0] },
        clientWidth: 300,
        isConnected: true,
        closest: () => ({ dataset: { postId: item.id } }),
      })
    })
    return state
  }
  return { component, makeState, timers }
}

test('shared covers consume one preview slot and release slots to subsequent images', () => {
  const { makeState, timers } = previewHarness()
  const state = makeState(['same', 'same', 'b', 'c', 'd', 'e'])
  state.queueVisibleImages()
  assert.equal(Object.keys(state.requestedImages).length, 4)
  assert.equal(timers.size, 4)
  assert.equal(state.postRuntime.pending.size, 4)
  assert.equal(state.postRuntime.queued.size, 1)
  state.onImageFailed('https://i0.hdslb.com/same.jpg')
  assert.ok(state.requestedImages['https://i0.hdslb.com/e.jpg'])
  assert.equal(timers.size, 4)
  assert.equal(state.postRuntime.pending.size, 4)
})

test('all day groups share the concurrency limit and destroying one releases its resources', () => {
  const { component, makeState, timers } = previewHarness()
  const first = makeState(['a', 'b', 'c', 'd', 'e'])
  const second = makeState(['f', 'g'])
  first.queueVisibleImages()
  second.queueVisibleImages()
  assert.equal(Object.keys(second.requestedImages).length, 0)
  component.beforeDestroy.call(first)
  assert.equal(first.postRuntime.pending.size, 0)
  assert.equal(first.postRuntime.queued.size, 0)
  assert.equal(Object.keys(second.requestedImages).length, 2)
  assert.equal(timers.size, 2)
  component.beforeDestroy.call(second)
  assert.equal(timers.size, 0)
})

test('queued images from paused tabs are not fetched when another image completes', () => {
  const { makeState } = previewHarness()
  const first = makeState(['a', 'b', 'c', 'd'])
  const second = makeState(['e'])
  first.queueVisibleImages()
  second.queueVisibleImages()
  second.active = false
  second.pauseObservers()
  first.onImageFailed('https://i0.hdslb.com/a.jpg')
  assert.equal(second.postRuntime.queued.size, 0)
  assert.equal(Object.keys(second.requestedImages).length, 0)
})

test('image timeout releases the shared slot instead of blocking every later image', () => {
  const { makeState, timers } = previewHarness()
  const state = makeState(['a', 'b', 'c', 'd', 'e'])
  state.queueVisibleImages()
  const timeout = timers.values().next().value
  timeout()
  assert.equal(state.failedImages['https://i0.hdslb.com/a.jpg'], true)
  assert.equal(state.requestedImages['https://i0.hdslb.com/a.jpg'], undefined)
  assert.ok(state.requestedImages['https://i0.hdslb.com/e.jpg'])
})

test('lottery filters remove stale columns and new pages keep existing card positions', () => {
  const component = load('PostDay.vue', { window: { innerHeight: 800 } })
  const state = stateFor(component, { group: { items: [post('a'), post('b'), post('c')] } })
  state.columnCount = 4
  state.columnIds = [[], [], ['a', 'b'], ['c']]
  state.assignColumns()
  assert.deepEqual(Array.from(state.columnIds[0]), ['a', 'b'])
  assert.deepEqual(Array.from(state.columnIds[1]), ['c'])
  state.group.items.push(post('d'))
  state.assignColumns()
  assert.deepEqual(Array.from(state.columnIds[0]), ['a', 'b'])
  assert.deepEqual(Array.from(state.columnIds[1]), ['c'])
  assert.deepEqual(Array.from(state.columnIds[2]), ['d'])
})

test('truncated posts expose their notice and remove fully clipped image buttons from tab order', () => {
  const component = load('PostDay.vue')
  const state = stateFor(component)
  const visible = { tabIndex: 0, getBoundingClientRect: () => ({ top: 180 }) }
  const clipped = { tabIndex: 0, getBoundingClientRect: () => ({ top: 320 }) }
  const body = {
    isConnected: true,
    dataset: { bodyId: 'post' },
    scrollHeight: 500,
    clientHeight: 250,
    getBoundingClientRect: () => ({ bottom: 300 }),
    querySelectorAll: () => [visible, clipped],
  }
  state.postRuntime.dirtyBodies.add(body)
  state.updateClippedBodies()
  assert.equal(state.clippedBodies.post, true)
  assert.equal(visible.tabIndex, 0)
  assert.equal(clipped.tabIndex, -1)
  body.clientHeight = 600
  state.postRuntime.dirtyBodies.add(body)
  state.updateClippedBodies()
  assert.equal(state.clippedBodies.post, false)
  assert.equal(clipped.tabIndex, 0)
})

const imageEvent = (url: string) => ({ target: { getAttribute: () => url } })
test('late load and failure events from a previous preview cannot corrupt the selected image', () => {
  const component = load('PostImageViewer.vue', { document: { activeElement: null } })
  const state = stateFor(component, { images: ['first.jpg', 'next.jpg'], initialIndex: 0 })
  state.$refs = { stage: { scrollTo: () => undefined } }
  state.onImageLoaded(imageEvent('first.jpg'))
  assert.equal(state.loaded, true)
  state.move(1)
  state.onImageFailed(imageEvent('first.jpg'))
  assert.equal(state.failed, false)
  state.onImageLoaded(imageEvent('first.jpg'))
  assert.equal(state.loaded, false)
  state.onImageLoaded(imageEvent('next.jpg'))
  assert.equal(state.loaded, true)
  state.disposed = true
  state.onImageFailed(imageEvent('next.jpg'))
  assert.equal(state.failed, false)
})

test('viewer keyboard handling stays bounded and stops Escape from leaking to the page', () => {
  const component = load('PostImageViewer.vue', { document: { activeElement: null } })
  const state = stateFor(component, { images: ['first.jpg', 'next.jpg'], initialIndex: 0 })
  state.$refs = { stage: { scrollTo: () => undefined } }
  let prevented = 0
  let stopped = 0
  let closed = 0
  state.$emit = (name: string) => {
    closed += name === 'close' ? 1 : 0
  }
  const key = (value: string) => ({
    key: value,
    preventDefault: () => {
      prevented++
    },
    stopPropagation: () => {
      stopped++
    },
  })
  state.onKeydown(key('ArrowLeft'))
  assert.equal(state.index, 0)
  state.onKeydown(key('ArrowRight'))
  state.onKeydown(key('ArrowRight'))
  assert.equal(state.index, 1)
  state.onKeydown(key('Escape'))
  assert.equal(closed, 1)
  assert.equal(prevented, 4)
  assert.equal(stopped, 4)
})

test('viewer restores background accessibility, focus, listeners and stylesheet on teardown', () => {
  class Element {
    attrs = new Map<string, string>()
    removed = false
    constructor(readonly tag = 'div') {}
    getAttribute(name: string) {
      return this.attrs.get(name) ?? null
    }
    setAttribute(name: string, value: string) {
      this.attrs.set(name, value)
    }
    removeAttribute(name: string) {
      this.attrs.delete(name)
    }
    matches() {
      return this.tag === 'script'
    }
    remove() {
      this.removed = true
    }
  }
  const existing = new Element()
  existing.setAttribute('inert', 'inert')
  existing.setAttribute('aria-hidden', 'false')
  const background = new Element()
  const overlay = new Element()
  const script = new Element('script')
  const sheet = new Element('style')
  const listeners = new Map<string, unknown>()
  const classes = new Set<string>()
  let restoredFocus = false
  let closeFocused = false
  const document = {
    body: { children: [existing, background, script, overlay], appendChild: () => undefined },
    documentElement: {
      classList: { add: (v: string) => classes.add(v), remove: (v: string) => classes.delete(v) },
    },
    addEventListener: (name: string, callback: unknown) => listeners.set(name, callback),
    removeEventListener: (name: string, callback: unknown) => {
      assert.equal(listeners.get(name), callback)
      listeners.delete(name)
    },
  }
  const source = componentSource('PostImageViewer.vue')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} as any }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: () => ({ addStyle: () => sheet }),
    document,
    HTMLElement: Element,
  })
  const component = module.exports.default
  const state = stateFor(component, {
    images: ['first.jpg'],
    initialIndex: 0,
    opener: {
      isConnected: true,
      focus: () => {
        restoredFocus = true
      },
    },
  })
  state.$el = overlay
  state.$refs = {
    close: {
      focus: () => {
        closeFocused = true
      },
    },
  }
  component.mounted.call(state)
  assert.equal(closeFocused, true)
  assert.equal(background.getAttribute('aria-hidden'), 'true')
  assert.equal(script.getAttribute('inert'), null)
  assert.equal(listeners.size, 2)
  assert.equal(classes.size, 1)
  component.beforeDestroy.call(state)
  assert.equal(background.getAttribute('inert'), null)
  assert.equal(background.getAttribute('aria-hidden'), null)
  assert.equal(existing.getAttribute('inert'), 'inert')
  assert.equal(existing.getAttribute('aria-hidden'), 'false')
  assert.equal(listeners.size, 0)
  assert.equal(classes.size, 0)
  assert.equal(sheet.removed, true)
  assert.equal(overlay.removed, true)
  assert.equal(restoredFocus, true)
})

test('Tab explicitly cycles preview controls even when WebKit skips native button navigation', () => {
  const document = { activeElement: null as any }
  const control = () => ({
    matches: () => false,
    getClientRects: () => [1],
    focus() {
      document.activeElement = this
    },
  })
  const first = control()
  const middle = control()
  const last = control()
  const component = load('PostImageViewer.vue', { document })
  const state = stateFor(component, { images: ['first.jpg'], initialIndex: 0 })
  state.$refs = { dialog: { querySelectorAll: () => [first, middle, last] } }
  const tab = (shiftKey: boolean) => ({
    key: 'Tab',
    shiftKey,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  })
  document.activeElement = middle
  state.onKeydown(tab(true))
  assert.equal(document.activeElement, first)
  state.onKeydown(tab(true))
  assert.equal(document.activeElement, last)
  state.onKeydown(tab(false))
  assert.equal(document.activeElement, first)
  document.activeElement = null
  state.onKeydown(tab(false))
  assert.equal(document.activeElement, first)
})
