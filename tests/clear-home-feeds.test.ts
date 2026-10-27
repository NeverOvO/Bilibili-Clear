import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const folder = 'registry/lib/components/style/clear-home/'
const tick = () => new Promise(resolve => setImmediate(resolve))
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const deferred = <T>() => {
  let resolve: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve: (value: T) => resolve(value) }
}
const load = (
  file: string,
  dependencies: Record<string, unknown>,
  globals: Record<string, unknown>,
) => {
  const source = readFileSync(path.join(root, folder, file), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} as any }
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    URL,
    URLSearchParams,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    require(name: string) {
      if (!(name in dependencies)) {
        throw new Error(`Unmocked dependency: ${name}`)
      }
      return dependencies[name]
    },
    ...globals,
  })
  vm.runInContext(outputText, context, { filename: file })
  return module.exports
}
const timers = { setTimeout, clearTimeout }
const response = (data: unknown) => ({ ok: true, json: async () => ({ code: 0, data }) })
const bvid = 'BV1234567890'
const video = (pubTs: number = Math.floor(Date.now() / 1000)) => ({
  id_str: '1001',
  type: 'DYNAMIC_TYPE_AV',
  modules: {
    module_author: { mid: 2, pub_ts: pubTs, following: true, name: '<script>unsafe</script>' },
    module_dynamic: {
      major: {
        type: 'MAJOR_TYPE_ARCHIVE',
        archive: {
          aid: 7,
          bvid,
          title: '<img src=x onerror=alert(1)>',
          cover: 'javascript:alert(1)',
          duration_text: '06:54',
        },
      },
    },
  },
})

test('following feed rejects invalid dates and external cover URLs while preserving text as data', async () => {
  const invalid = video(1e308)
  invalid.id_str = '1002'
  let calls = 0
  const api = load(
    'following.ts',
    {
      '@/core/utils': { getUID: () => '1' },
      '@/components/feeds/api': { getFeedsUrl: () => 'https://api.bilibili.com/feed' },
    },
    {
      window: timers,
      fetch: async () =>
        ++calls === 1
          ? response({ isLogin: true, mid: 1 })
          : response({ items: [video(), invalid], has_more: false, offset: '' }),
    },
  )
  const page = await api.fetchFollowingPage()
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].video.cover, '')
  assert.equal(page.items[0].title, '<img src=x onerror=alert(1)>')
  assert.equal(page.items[0].url, `https://www.bilibili.com/video/${bvid}/`)
})

test('following feed rejects an account change during a cursor request', async () => {
  let uid = '1'
  let calls = 0
  const api = load(
    'following.ts',
    {
      '@/core/utils': { getUID: () => uid },
      '@/components/feeds/api': { getFeedsUrl: () => 'https://api.bilibili.com/feed' },
    },
    {
      window: timers,
      fetch: async () => {
        if (++calls === 1) {
          return response({ isLogin: true, mid: 1 })
        }
        uid = '9'
        return response({ items: [video()], has_more: false, offset: '' })
      },
    },
  )
  await assert.rejects(api.fetchFollowingPage(), { kind: 'account-changed' })
})

test('post hydration retains full paragraphs from array modules with null placeholders', async () => {
  const item = {
    id: '1001',
    kind: 'post',
    timestamp: Date.now(),
    author: { id: '2', name: 'UP', face: '' },
    title: '',
    text: '摘要',
    images: [],
    url: 'https://t.bilibili.com/1001',
  }
  const api = load(
    'following.ts',
    {
      '@/core/utils': { getUID: () => '1' },
      '@/components/feeds/api': {},
    },
    {
      window: timers,
      fetch: async () =>
        response({
          item: {
            id_str: item.id,
            type: 'DYNAMIC_TYPE_OPUS',
            modules: [
              { module_author: { mid: 2, pub_ts: item.timestamp / 1000 }, module_content: null },
              {
                module_author: null,
                module_content: {
                  paragraphs: [
                    { para_type: 1, text: { nodes: [{ words: { words: '完整第一段' } }] } },
                    { para_type: 1, text: { text: '第二段' } },
                  ],
                },
              },
            ],
          },
        }),
    },
  )
  const detail = await api.fetchFollowingPostDetail(item, '1')
  assert.equal(detail.text, '完整第一段\n\n第二段')
  assert.equal(detail.postContentStatus, 'resolved')
})

test('post folding is reversible, never merges unresolved bodies or image-only reactions across authors', () => {
  const { groupSuspectedPosts } = load('post-filter.ts', {}, {})
  const base = {
    id: '1',
    kind: 'post',
    timestamp: Date.now(),
    author: { id: '2' },
    title: '',
    text: '京东双11点击蓝链领取优惠券与红包',
    images: ['https://i0.hdslb.com/a.jpg'],
    postContentStatus: 'unavailable',
  }
  const unresolved = groupSuspectedPosts([base, { ...base, id: '2' }])
  assert.equal(unresolved.folded.length, 2)
  const reactions = groupSuspectedPosts([
    { ...base, text: '', postContentStatus: 'resolved' },
    { ...base, id: '3', author: { id: '3' }, text: '', postContentStatus: 'resolved' },
  ])
  assert.equal(reactions.visible.length, 2)
  const same = groupSuspectedPosts([
    { ...base, text: '京东点击领取红包。'.repeat(12), postContentStatus: 'resolved' },
    { ...base, id: '4', text: '京东点击领取红包。'.repeat(12), postContentStatus: 'resolved' },
  ])
  assert.equal(same.folded.length, 1)
  assert.equal(same.folded[0].items.length, 2)
})

const progressEnvironment = (savedRecords: any[] = []) => {
  let uid = '1'
  let observerCallback = () => undefined
  let media: any = null
  const saved = new Map<string, any>([
    ['bilibiliClear.watchProgress.v1.1', { version: 1, records: savedRecords }],
  ])
  const win = Object.assign(new EventTarget(), timers)
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', body: {} })
  const api = load(
    'progress.ts',
    {
      '@/core/utils': { getUID: () => uid, dq: () => media },
      '@/core/observer': {
        childListSubtree: (_target: unknown, callback: () => void) => {
          observerCallback = callback
          callback()
          return [{ disconnect: () => undefined }]
        },
        urlChange: () => undefined,
        videoChange: () => undefined,
      },
    },
    {
      window: win,
      document: doc,
      location: new URL(`https://www.bilibili.com/video/${bvid}/`),
      unsafeWindow: { cid: 101 },
      GM_getValue: (key: string) => saved.get(key),
      GM_setValue: (key: string, value: any) => saved.set(key, value),
      fetch: async () => response({ bvid, pages: [{ page: 1, cid: 101 }] }),
    },
  )
  return {
    api,
    saved,
    doc,
    win,
    setUID: (value: string) => {
      uid = value
    },
    setMedia: (value: any) => {
      media = value
      observerCallback()
    },
  }
}
const progress = (position: number, duration: number, extras = {}) => ({
  bvid,
  cid: 101,
  page: 1,
  pages: 1,
  position,
  duration,
  source: 'local',
  updatedAt: Date.now() - 1000,
  completedParts: {},
  ...extras,
})

test('completion threshold preserves true position and only whole multi-part completion marks the cover', () => {
  const cases = [
    [progress(950, 1000), true, false],
    [progress(370, 400), false, false],
    [progress(371, 400), true, false],
    [progress(0, 10), false, false],
    [progress(400, 400), true, true],
    [progress(950, 1000, { pages: 2 }), false, false],
    [progress(950, 1000, { pages: 2, completedParts: { 2: 102 } }), true, false],
  ]
  for (const [record, completed, playbackEnded] of cases) {
    const environment = progressEnvironment([record])
    const store = environment.api.createProgressStore()
    const actual = store.get(bvid)
    assert.equal(actual.completed, completed)
    assert.equal(actual.playbackEnded, playbackEnded)
    assert.equal(actual.position, (record as any).position)
    store.dispose()
  }
})

test('progress lookup changes account without leaking another account stored records', () => {
  const env = progressEnvironment([progress(50, 400)])
  const store = env.api.createProgressStore()
  assert.equal(store.get(bvid).position, 50)
  env.setUID('2')
  assert.equal(store.get(bvid), undefined)
  env.setUID('1')
  assert.equal(store.get(bvid).position, 50)
  store.dispose()
})

class Media extends EventTarget {
  currentTime = 10
  duration = 400
  paused = false
  readyState = 4
  ended = false
}

test('a replacement media element cannot inherit readiness/completion evidence from the previous element', async () => {
  const env = progressEnvironment()
  const first = new Media()
  env.setMedia(first)
  const store = env.api.createProgressStore()
  store.startTracking()
  await tick()
  first.dispatchEvent(new Event('playing'))
  first.dispatchEvent(new Event('timeupdate'))
  assert.equal(store.get(bvid).position, 10)
  const next = new Media()
  next.paused = true
  next.readyState = 1
  next.currentTime = 399
  env.setMedia(next)
  await tick()
  next.dispatchEvent(new Event('timeupdate'))
  next.dispatchEvent(new Event('pause'))
  assert.equal(store.get(bvid).position, 10)
  assert.equal(store.get(bvid).completed, false)
  next.dispatchEvent(new Event('loadedmetadata'))
  next.dispatchEvent(new Event('playing'))
  next.dispatchEvent(new Event('timeupdate'))
  assert.equal(store.get(bvid).position, 399)
  assert.equal(store.get(bvid).completed, true)
  store.dispose()
})

test('an old watch-later snapshot cannot erase a confirmed single addition in the shared cache', async () => {
  const shared: number[] = []
  const old = deferred<unknown>()
  const api = load(
    'watchlater.ts',
    {
      '@/core/utils': { getUID: () => '1', getCsrf: () => 'local-test-csrf' },
      '@/components/video/watchlater': { watchlaterList: shared },
    },
    {
      window: timers,
      fetch: async (url: string) =>
        url.endsWith('/web') ? { ok: true, json: () => old.promise } : response(null),
    },
  )
  const reading = api.fetchWatchlater()
  await api.addWatchlaterVideo(7)
  old.resolve({ code: 0, data: { count: 1, list: [{ aid: 6 }] } })
  assert.deepEqual(plain(await reading), { count: 1, aids: [6] })
  assert.deepEqual(shared, [6, 7])
})

test('watch-later batch skips existing items and submits latest publications first for native newest-add sorting', async () => {
  const submitted: number[] = []
  const api = load(
    'watchlater.ts',
    {
      '@/core/utils': { getUID: () => '1', getCsrf: () => 'local-test-csrf' },
      '@/components/video/watchlater': { watchlaterList: [] },
    },
    {
      window: {
        ...timers,
        setTimeout: (callback: () => void, delay: number) =>
          setTimeout(callback, delay === 1100 ? 0 : delay),
      },
      fetch: async (url: string, options: any) => {
        if (url.endsWith('/web')) {
          return response({ count: 1, list: [{ aid: 9 }] })
        }
        submitted.push(Number(options.body.get('aid')))
        return response(null)
      },
    },
  )
  const result = await api.addWatchlaterBatch([
    { aid: 7, bvid, publishedAt: 100 },
    { aid: 8, bvid: 'BV1234567891', publishedAt: 200 },
    { aid: 9, bvid: 'BV1234567892', publishedAt: 300 },
  ])
  assert.deepEqual(submitted, [8, 7])
  assert.deepEqual(plain(result), { added: [8, 7], existing: [9], failed: [], cancelled: false })
})
