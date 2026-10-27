import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the actual modules with isolated DOM/network dependencies. These tests
// cover state transitions; they do not stand in for Bilibili/Safari integration.
const loadModule = (filename: string, imports: Record<string, unknown>, globals = {}) => {
  const source = readFileSync(
    path.resolve('registry/lib/components/style/clear-home', filename),
    'utf8',
  )
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exported: Record<string, any> = {}
  vm.runInNewContext(
    code,
    {
      exports: exported,
      module: { exports: exported },
      URL,
      URLSearchParams,
      Promise,
      AbortController,
      DOMException,
      console,
      require(id: string) {
        assert.ok(id in imports, `Unexpected dependency: ${id}`)
        return imports[id]
      },
      ...globals,
    },
    { filename },
  )
  return exported
}

class ElementStub extends EventTarget {
  classList = { add: () => undefined, remove: () => undefined }
  parentElement: ElementStub | null = null
  isConnected = true
  textContent = ''
  tabIndex = 0
  matches() {
    return false
  }
  getClientRects() {
    return [{}]
  }
}

class MediaStub extends ElementStub {
  paused = true
  ended = false
  muted = false
  volume = 1
  readyState = 1
  duration = 100
  autoplay = true
  preload = ''
  tagName = 'VIDEO'
  playCalls = 0
  play() {
    this.playCalls++
    this.paused = false
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  }
  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

const bvid = 'BV0000000001'
const origin = 'https://www.bilibili.com'
const playerUrl = `${origin}/video/${bvid}/`
const environment = () => {
  let timerId = 0
  const timers = new Map<number, { callback: () => void; delay: number }>()
  const schedule = (callback: () => void, delay: number) => {
    const id = ++timerId
    timers.set(id, { callback, delay })
    return id
  }
  const cancel = (id: number) => {
    timers.delete(id)
  }
  const observers: Array<{ callback: () => void; active: boolean; disconnect: () => void }> = []
  const childListSubtree = (_target: unknown, callback: () => void) => {
    const observer = {
      callback,
      active: true,
      disconnect() {
        this.active = false
      },
    }
    observers.push(observer)
    callback()
    return [observer]
  }
  const makeDocument = (url: string, media?: MediaStub) => {
    let player: ElementStub | null = null
    const document = Object.assign(new EventTarget(), {
      URL: url,
      body: new ElementStub(),
      head: new ElementStub(),
      documentElement: new ElementStub(),
      fullscreenElement: null,
      defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
      result: null as ElementStub | null,
      querySelector(selector: string): ElementStub | null {
        if (selector.includes('lottery-result')) {
          return this.result
        }
        return selector.includes('bpx-player-container') ? player : null
      },
      querySelectorAll: () => [],
    })
    player = media
      ? Object.assign(new ElementStub(), {
          parentElement: document.body,
          querySelector: (selector: string) => (selector.includes('bwp-video') ? null : media),
        })
      : null
    return document
  }
  const initial = makeDocument('about:blank')
  const iframe = Object.assign(new EventTarget(), {
    src: '',
    allow: '',
    contentDocument: initial,
    contentWindow: { cid: 123, location: { href: 'about:blank' } },
    getAttribute(name: string) {
      return name === 'src' ? this.src : null
    },
  })
  const window = {
    setTimeout: schedule,
    clearTimeout: cancel,
    setInterval: schedule,
    clearInterval: cancel,
  }
  return {
    iframe,
    timers,
    makeDocument,
    imports: {
      '@/core/observer': { childListSubtree },
      '@/core/style': { addStyle: () => ({ isConnected: true, remove: () => undefined }) },
      './native-player.scss': '',
    },
    globals: { window, document: { hidden: false }, location: { origin }, clearTimeout: cancel },
    attach(document: ReturnType<typeof makeDocument>) {
      iframe.contentDocument = document
      iframe.contentWindow.location.href = document.URL
      iframe.dispatchEvent(new Event('load'))
    },
    mutation() {
      observers.filter(item => item.active).forEach(item => item.callback())
    },
    fireTimeout(delay: number) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === delay) {
          timers.delete(id)
          timer.callback()
        }
      }
    },
  }
}

test('native player resets readiness and rearms timeout after a same-video document reload', async () => {
  const env = environment()
  const { mountNativePlayer } = loadModule('native-player.ts', env.imports, env.globals)
  const states: any[] = []
  const controller = mountNativePlayer(env.iframe, {
    bvid,
    cid: 123,
    onState: state => states.push(state),
  })
  env.attach(env.makeDocument(playerUrl, new MediaStub()))
  await Promise.resolve()
  assert.equal(states.at(-1).ready, true)
  assert.equal(states.at(-1).playing, true)
  env.attach(env.makeDocument(playerUrl))
  assert.equal(states.at(-1).ready, false)
  assert.equal(states.at(-1).playing, false)
  env.fireTimeout(25000)
  assert.match(states.at(-1).error, /加载超时/)
  assert.equal(env.iframe.src, 'about:blank')
  controller.dispose()
  assert.equal(env.timers.size, 0)
})

test('preloaded player cannot play until activation and owned playback recovers a media error', async () => {
  const env = environment()
  const { mountNativePlayer } = loadModule('native-player.ts', env.imports, env.globals)
  const states: any[] = []
  const controller = mountNativePlayer(env.iframe, {
    bvid,
    cid: 123,
    preload: true,
    onState: state => states.push(state),
  })
  const media = new MediaStub()
  env.attach(env.makeDocument(playerUrl, media))
  assert.equal(media.playCalls, 0)
  assert.equal(media.muted, true)
  await controller.play()
  assert.equal(media.playCalls, 1)
  assert.equal(media.muted, false)
  media.dispatchEvent(new Event('error'))
  assert.ok(states.at(-1).error)
  media.dispatchEvent(new Event('playing'))
  assert.equal(states.at(-1).error, '')
  controller.dispose()
  assert.equal(media.paused, true)
})

test('native player stops when document ownership changes and ignores late media events', async () => {
  const env = environment()
  const { mountNativePlayer } = loadModule('native-player.ts', env.imports, env.globals)
  const states: any[] = []
  const controller = mountNativePlayer(env.iframe, {
    bvid,
    cid: 123,
    onState: state => states.push(state),
  })
  const media = new MediaStub()
  env.attach(env.makeDocument(playerUrl, media))
  await Promise.resolve()
  env.attach(env.makeDocument(`${origin}/video/BV0000000002/`, new MediaStub()))
  assert.match(states.at(-1).error, /离开当前推荐视频/)
  const last = states.at(-1)
  media.dispatchEvent(new Event('playing'))
  assert.equal(states.at(-1), last)
  assert.equal(env.iframe.src, 'about:blank')
  controller.dispose()
})

test('lottery URL only accepts the official origin, path, business type and matching post', () => {
  const { getNativeLotteryDetailUrl } = loadModule('native-lottery.ts', { '@/core/observer': {} })
  const lottery = {
    id: '998',
    dynamicId: '123',
    nativeUrl: `${origin}/h5/lottery/result?business_type=1&business_id=123&extra=discard`,
  }
  assert.equal(
    getNativeLotteryDetailUrl(lottery),
    `${origin}/h5/lottery/result?business_type=1&business_id=123&isWeb=1`,
  )
  for (const nativeUrl of [
    'javascript:alert(1)',
    'https://www.bilibili.com.evil.test/h5/lottery/result?business_type=1&business_id=123',
    `${origin}/h5/lottery/result?business_type=1&business_id=456`,
    `${origin}/h5/lottery/result?business_type=999&business_id=123`,
    `${origin}/video/BV0000000001`,
  ]) {
    assert.equal(getNativeLotteryDetailUrl({ ...lottery, nativeUrl }), undefined)
  }
})

test('lottery frame stays loading for an empty SPA and releases its document on close', () => {
  const env = environment()
  const { mountNativeLotteryFrame } = loadModule('native-lottery.ts', env.imports, env.globals)
  const states: any[] = []
  const lottery = {
    id: '998',
    dynamicId: '123',
    nativeUrl: `${origin}/h5/lottery/result?business_type=1&business_id=123`,
  }
  const dispose = mountNativeLotteryFrame(env.iframe, lottery, {
    onState: state => states.push(state),
    onClose: () => undefined,
    onFocusBoundary: () => undefined,
  })
  const nativeDocument = env.makeDocument(env.iframe.src)
  env.attach(nativeDocument)
  assert.equal(states.at(-1).loaded, false)
  nativeDocument.result = Object.assign(new ElementStub(), { textContent: '抽奖详情' })
  env.mutation()
  assert.equal(states.at(-1).loaded, true)
  dispose()
  assert.equal(env.iframe.src, 'about:blank')
  assert.equal(env.timers.size, 0)
})

test('recommendation filtering rejects ads, non-video entries and metadata/tag dramas', async () => {
  const env = environment()
  const calls: string[] = []
  const candidates = [
    { bvid, goto: 'av', title: '普通视频' },
    { bvid: 'BV0000000002', goto: 'av', title: '广告', is_ad: 1 },
    { bvid: 'BV0000000003', goto: 'live', title: '直播' },
    { bvid: 'BV0000000004', goto: 'av', title: '普通标题' },
    { bvid, goto: 'av', title: '重复视频' },
  ]
  const fetch = async (input: string) => {
    const url = new URL(input)
    calls.push(url.pathname)
    let data: any
    if (url.pathname.endsWith('/rcmd')) {
      data = { item: candidates }
    } else if (url.pathname.endsWith('/view')) {
      const id = url.searchParams.get('bvid')
      data = {
        bvid: id,
        aid: id === bvid ? 1 : 4,
        cid: 123,
        owner: { mid: 88, name: 'UP' },
        title: '视频',
        pic: 'https://i0.hdslb.com/cover.jpg',
      }
    } else {
      data = url.searchParams.get('aid') === '4' ? [{ tag_name: '短剧' }] : []
    }
    return { ok: true, json: async () => ({ code: 0, data }) }
  }
  const { fetchRecommendations } = loadModule(
    'recommendations.ts',
    { '@/core/utils': { getUID: () => '123' } },
    { ...env.globals, fetch },
  )
  const batch = await fetchRecommendations()
  assert.equal(batch.items.length, 1)
  assert.equal(batch.items[0].bvid, bvid)
  assert.equal(batch.filtered, 4)
  assert.equal(calls.filter(item => item.endsWith('/view')).length, 2)
})
