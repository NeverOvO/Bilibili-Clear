import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const folder = path.join(process.cwd(), 'registry/lib/components/style/clear-home')
const load = (file: string, dependencies: Record<string, unknown>, globals = {}) => {
  let source = readFileSync(path.join(folder, file), 'utf8')
  if (file.endsWith('.vue')) {
    source = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1]
  }
  const module = { exports: {} as any }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  vm.runInNewContext(
    outputText,
    {
      module,
      exports: module.exports,
      URL,
      AbortController,
      DOMException,
      setTimeout,
      clearTimeout,
      window: { setTimeout, clearTimeout },
      require(name: string) {
        if (!(name in dependencies)) {
          throw new Error(`Unmocked dependency: ${name}`)
        }
        return dependencies[name]
      },
      ...globals,
    },
    { filename: file },
  )
  return module.exports
}
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const response = (data: unknown) => ({ ok: true, json: async () => ({ code: 0, data }) })
const post = (overrides = {}) => ({
  id: '1001',
  kind: 'post',
  timestamp: 1_790_000_000_000,
  author: { id: '2', name: 'UP', face: '' },
  title: '',
  text: '',
  images: [],
  url: 'https://t.bilibili.com/1001',
  ...overrides,
})
const rawPost = (modules = {}, overrides = {}) => ({
  id_str: '1001',
  type: 'DYNAMIC_TYPE_OPUS',
  modules: {
    module_author: { mid: 2, pub_ts: 1_790_000_000, following: true },
    ...modules,
  },
  ...overrides,
})
const fullBody = (body: string) => ({
  module_content: { paragraphs: [{ para_type: 1, text: { text: body } }] },
})
const htmlResponse = (raw: unknown) => ({
  ok: true,
  headers: { get: () => 'text/html; charset=utf-8' },
  text: async () =>
    `<script>window.__INITIAL_STATE__=${JSON.stringify({ id: '1001', detail: raw })};</script>`,
})
const apiEnvironment = (fetch: (url: string, options?: any) => Promise<any>) => {
  let uid = '1'
  const api = load(
    'following.ts',
    {
      '@/core/utils': { getUID: () => uid },
      '@/components/feeds/api': {
        getFeedsUrl: (_type, offset) => `https://api.bilibili.com/feed?offset=${offset}`,
      },
    },
    { fetch },
  )
  return {
    api,
    setUID: (value: string) => {
      uid = value
    },
  }
}

test('article cards require explicit article metadata, not a title or a long Opus body', async () => {
  const items = [
    rawPost({
      module_dynamic: {
        major: { opus: { title: '有标题的普通动态', summary: { text: '长正文'.repeat(1000) } } },
      },
    }),
    rawPost(
      {
        module_author: { mid: 2, pub_ts: 1_790_000_000, following: true, pub_action: '投稿了文章' },
        module_dynamic: {
          major: { opus: { title: '文章', pics: [{ url: 'https://i0.hdslb.com/cover.jpg' }] } },
        },
      },
      { id_str: '1002' },
    ),
    rawPost(
      {
        module_dynamic: {
          major: {
            type: 'MAJOR_TYPE_ARTICLE',
            article: {
              id: 3,
              title: '专栏文章',
              covers: ['javascript:alert(1)', 'https://i0.hdslb.com/article.jpg'],
            },
          },
        },
      },
      { id_str: '1003', type: 'DYNAMIC_TYPE_ARTICLE' },
    ),
  ]
  const { api } = apiEnvironment(async url =>
    url.endsWith('/nav')
      ? response({ isLogin: true, mid: 1 })
      : response({ items, has_more: false }),
  )
  const page = await api.fetchFollowingPage()
  assert.equal(page.items[0].article, undefined)
  assert.deepEqual(plain(page.items[1].article), {
    title: '文章',
    cover: 'https://i0.hdslb.com/cover.jpg',
  })
  assert.deepEqual(plain(page.items[2].article), {
    title: '专栏文章',
    cover: 'https://i0.hdslb.com/article.jpg',
  })
})

test('article previews still discover lottery metadata from full original content', async () => {
  const preview = rawPost(
    {
      module_dynamic: {
        major: { type: 'MAJOR_TYPE_ARTICLE', article: { id: 9, title: '文章标题' } },
      },
    },
    { type: 'DYNAMIC_TYPE_ARTICLE' },
  )
  const original = rawPost({
    module_content: {
      paragraphs: [
        {
          para_type: 1,
          text: {
            rich_text_nodes: [{ type: 'RICH_TEXT_NODE_TYPE_LOTTERY', rid: '55', text: '互动抽奖' }],
          },
        },
      ],
    },
  })
  const calls: string[] = []
  const { api } = apiEnvironment(async url => {
    calls.push(url)
    return url.includes('/opus/') ? htmlResponse(original) : response({ item: preview })
  })
  const result = await api.fetchFollowingPostDetail(post(), '1')
  assert.equal(calls.length, 2)
  assert.equal(result.article.title, '文章标题')
  assert.equal(result.lottery.id, '55')
  assert.equal(result.lotteryChecked, true)
})

test('body from detail API is emitted before a slow original-page fallback finishes', async () => {
  let finishOriginal: (value: unknown) => void
  const original = new Promise(resolve => {
    finishOriginal = resolve
  })
  const partials: any[] = []
  const { api } = apiEnvironment(async url =>
    url.includes('/opus/')
      ? original
      : response({ item: rawPost({ module_dynamic: { desc: { text: '先可见的正文摘要' } } }) }),
  )
  const pending = api.fetchFollowingPostDetail(post(), '1', undefined, value =>
    partials.push(value),
  )
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(partials.length, 1)
  assert.equal(partials[0].text, '先可见的正文摘要')
  finishOriginal(htmlResponse(rawPost(fullBody('完整正文'))))
  const result = await pending
  assert.equal(result.text, '完整正文')
  assert.equal(result.postContentStatus, 'resolved')
})

test('resolved body survives partial refreshes and cached bodies never cross accounts', async () => {
  let detailRequests = 0
  const { api, setUID } = apiEnvironment(async url => {
    if (url.endsWith('/nav')) {
      return response({ isLogin: true, mid: 1 })
    }
    if (url.includes('/feed?')) {
      return response({ items: [rawPost()], has_more: false })
    }
    detailRequests++
    return response({
      item: rawPost(fullBody(detailRequests === 1 ? '原账号完整正文' : '新账号正文')),
    })
  })
  await api.fetchFollowingPostDetail(post(), '1')
  const refreshed = await api.fetchFollowingPage()
  assert.equal(refreshed.items[0].text, '原账号完整正文')
  await api.fetchFollowingPostDetail(post(), '1')
  assert.equal(detailRequests, 1)
  setUID('3')
  const other = await api.fetchFollowingPostDetail(post(), '3')
  assert.equal(other.text, '新账号正文')
  assert.equal(detailRequests, 2)
})

test('blocked responses invalidate old successful bodies without trying alternate endpoints', async () => {
  let blocked = false
  const calls: string[] = []
  const { api } = apiEnvironment(async url => {
    calls.push(url)
    if (url.endsWith('/nav')) {
      return response({ isLogin: true, mid: 1 })
    }
    const item = blocked
      ? rawPost({ module_blocked: { title: '充电专属' } })
      : rawPost(fullBody('此前允许读取的正文'))
    return url.includes('/feed?')
      ? response({ items: [item], has_more: false })
      : response({ item })
  })
  await api.fetchFollowingPostDetail(post(), '1')
  blocked = true
  const refreshed = await api.fetchFollowingPage()
  const detail = await api.fetchFollowingPostDetail(refreshed.items[0], '1')
  assert.equal(detail.postContentRestricted, true)
  assert.equal(detail.text, '')
  assert.equal(
    calls.some(url => url.includes('/opus/')),
    false,
  )
})

test('rate limits and permission responses stop hydration without falling back to original HTML', async () => {
  for (const code of [-101, -403, -412, -352]) {
    let calls = 0
    const { api } = apiEnvironment(async () => {
      calls++
      return { ok: true, json: async () => ({ code }) }
    })
    await assert.rejects(api.fetchFollowingPostDetail(post(), '1'), { code })
    assert.equal(calls, 1)
  }
})

test('transport failure can use same-post HTML while account switches reject old content', async () => {
  let calls = 0
  const environment = apiEnvironment(async url => {
    calls++
    if (url.includes('/opus/')) {
      return htmlResponse(rawPost(fullBody('可恢复正文')))
    }
    throw new TypeError('offline')
  })
  assert.equal((await environment.api.fetchFollowingPostDetail(post(), '1')).text, '可恢复正文')
  assert.equal(calls, 2)
  const switched = apiEnvironment(async () => {
    switched.setUID('9')
    return response({ item: rawPost(fullBody('旧账号正文')) })
  })
  await assert.rejects(switched.api.fetchFollowingPostDetail(post(), '1'), {
    kind: 'account-changed',
  })
})

test('incomplete body and failed original reads remain retryable instead of becoming cached success', async () => {
  let attempt = 0
  const { api } = apiEnvironment(async url => {
    if (url.includes('/opus/')) {
      throw new TypeError('temporary network failure')
    }
    attempt++
    return response({ item: attempt === 1 ? rawPost() : rawPost(fullBody('重试后完整正文')) })
  })
  const first = await api.fetchFollowingPostDetail(post(), '1')
  assert.equal(first.postContentStatus, 'unavailable')
  const retried = await api.fetchFollowingPostDetail(first, '1')
  assert.equal(retried.text, '重试后完整正文')
  assert.equal(attempt, 2)
})

test('post grouping invalidates cached fingerprints when bodies, images or completion change', () => {
  const { groupSuspectedPosts } = load('post-filter.ts', {})
  const body = '这是一篇足够长而且没有营销引导的普通动态，介绍这周创作过程中的新发现。'.repeat(3)
  const a = post({ text: body, postContentStatus: 'resolved' })
  const b = post({ id: '1002', text: body, postContentStatus: 'unavailable' })
  assert.equal(groupSuspectedPosts([a, b]).visible.length, 2)
  b.postContentStatus = 'resolved'
  assert.equal(groupSuspectedPosts([a, b]).folded.length, 1)
  b.images.push('https://i0.hdslb.com/different.jpg')
  assert.equal(groupSuspectedPosts([a, b]).visible.length, 2)
  b.images.length = 0
  b.text = '完全不同的新动态'.repeat(15)
  assert.equal(groupSuspectedPosts([a, b]).visible.length, 2)
})

const feedEnvironment = () => {
  let uid = '1'
  const following = apiEnvironment(async () => response({})).api
  const component = load(
    'FollowingFeed.vue',
    {
      '@/core/utils': { getUID: () => uid },
      '@/core/observer': {},
      './following': following,
      './runtime': {},
      './watchlater': {},
      './post-filter': load('post-filter.ts', {}),
      './VideoTile.vue': {},
      './PostDay.vue': {},
      './LotteryDialog.vue': {},
    },
    {
      window: {
        setTimeout: (callback: () => void, delay: number) =>
          setTimeout(callback, delay === 500 ? 0 : delay),
        clearTimeout,
      },
    },
  ).default
  const view: any = { active: true }
  component.beforeCreate.call(view)
  Object.assign(view, component.data.call(view))
  for (const [name, method] of Object.entries(component.methods)) {
    view[name] = (method as (...args: any[]) => unknown).bind(view)
  }
  for (const [name, getter] of Object.entries(component.computed)) {
    Object.defineProperty(view, name, { get: () => (getter as () => unknown).call(view) })
  }
  view.$set = (target, key, value) => {
    target[key] = value
  }
  view.$delete = (target, key) => {
    delete target[key]
  }
  view.$nextTick = () => undefined
  return {
    view,
    following,
    setUID: (value: string) => {
      uid = value
    },
  }
}

test('hiding the feed preserves successful details waiting for the render batch', () => {
  const { view } = feedEnvironment()
  view.items = [post()]
  view.postDetailStates['1001'] = 'loaded'
  view.queuePostDetail(
    post({ text: '成功读取的正文', postContentStatus: 'resolved', lotteryChecked: true }),
  )
  view.active = false
  view.cancelPostBodies()
  assert.equal(view.items[0].text, '成功读取的正文')
  assert.equal(view.postRuntime.pendingDetails.size, 0)
  assert.equal(view.postDetailStates['1001'], 'loaded')
})

test('hiding after an account switch discards queued private responses', () => {
  const { view, setUID } = feedEnvironment()
  view.items = [post()]
  view.queuePostDetail(post({ text: '旧账号未渲染正文', postContentStatus: 'resolved' }))
  setUID('9')
  view.cancelPostBodies()
  assert.equal(view.items[0].text, '')
  assert.equal(view.postRuntime.pendingDetails.size, 0)
})

test('lottery search queues hidden unknown posts and bounds each manual pagination batch', () => {
  const { view } = feedEnvironment()
  const known = post({ id: '1002', postContentStatus: 'resolved', lotteryChecked: true })
  view.items = [post(), known]
  view.section = 'post'
  view.lotteryOnly = true
  view.drainPostQueue = () => undefined
  view.loadPostBodies()
  assert.deepEqual(plain(view.postDetailQueue), ['1001'])
  const counts: number[] = []
  view.loadPages = count => counts.push(count)
  view.loadMore()
  assert.deepEqual(counts, [4])
  view.lotteryOnly = false
  view.loadMore()
  assert.deepEqual(counts, [4, 1])
})

test('filter/layout notifications alone cannot start unlimited pagination', () => {
  const { view } = feedEnvironment()
  view.section = 'post'
  view.lotteryOnly = true
  view.pagesLoaded = 4
  view.nearBottom = true
  let calls = 0
  view.loadPages = () => {
    calls++
  }
  view.tryAutoLoad()
  assert.equal(calls, 0)
  view.autoLoadArmed = true
  view.tryAutoLoad()
  view.tryAutoLoad()
  assert.equal(calls, 1)
  view.toggleLotteryFilter()
  assert.equal(calls, 1)
})

test('post hydration drains hidden lottery candidates with at most two simultaneous requests', async () => {
  const { view, following } = feedEnvironment()
  view.items = Array.from({ length: 6 }, (_, index) => post({ id: String(1001 + index) }))
  view.section = 'post'
  view.lotteryOnly = true
  let running = 0
  let maximum = 0
  let calls = 0
  following.fetchFollowingPostDetail = async item => {
    calls++
    running++
    maximum = Math.max(maximum, running)
    await new Promise(resolve => setImmediate(resolve))
    running--
    return { ...item, text: '正文已读', postContentStatus: 'resolved', lotteryChecked: true }
  }
  view.enqueuePostBodies(view.items)
  await view.drainPostQueue()
  assert.equal(maximum, 2)
  assert.equal(calls, 6)
  assert.equal(view.postDetailQueue.length, 0)
  assert.equal(view.postDetailPending, 0)
  assert.equal(
    view.items.every(item => item.text === '正文已读'),
    true,
  )
})

test('rate limiting pauses both workers and leaves the cancelled peer retryable', async () => {
  const { view, following } = feedEnvironment()
  view.items = Array.from({ length: 4 }, (_, index) => post({ id: String(1001 + index) }))
  view.section = 'post'
  let calls = 0
  following.fetchFollowingPostDetail = async (_item, _account, signal) => {
    calls++
    if (calls === 1) {
      throw new following.FollowingApiError('请稍后重试', 'api', -412)
    }
    await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Abort', 'AbortError')), {
        once: true,
      })
    })
  }
  view.enqueuePostBodies(view.items)
  await view.drainPostQueue()
  assert.equal(calls, 2)
  assert.equal(view.detailsPaused, true)
  assert.equal(view.postDetailStates['1001'], 'failed')
  assert.equal(view.postDetailStates['1002'], 'queued')
  assert.equal(view.postDetailQueue.includes('1002'), true)
  await view.drainPostQueue()
  assert.equal(calls, 2)
})
