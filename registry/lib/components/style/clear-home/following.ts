import { getFeedsUrl } from '@/components/feeds/api'
import { getUID } from '@/core/utils'

export interface FollowingItem {
  id: string
  kind: 'video' | 'post'
  /** Publication time in milliseconds, grouped by the viewer's local calendar. */
  timestamp: number
  author: { id: string; name: string; face: string }
  text: string
  title: string
  images: string[]
  url: string
  video?: {
    bvid: string
    aid: number
    cover: string
    duration: number
    playCount: string
  }
}

export interface FollowingPage {
  accountId: string
  items: FollowingItem[]
  offset: string
  hasMore: boolean
}

export class FollowingApiError extends Error {
  constructor(
    message: string,
    public readonly kind: 'login' | 'network' | 'timeout' | 'api' | 'format' | 'account-changed',
    public readonly code?: number,
  ) {
    super(message)
    this.name = 'FollowingApiError'
  }
}

type ApiObject = Record<string, any>
const object = (value: unknown): ApiObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const id = (value: unknown) => (/^[1-9]\d*$/.test(String(value)) ? String(value) : '')
const positiveNumber = (value: unknown) => {
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? result : 0
}

/** Only use Bilibili image hosts; API strings never become executable markup or links. */
const imageUrl = (value: unknown) => {
  const source = text(value)
  if (!source) {
    return ''
  }
  try {
    const url = new URL(source, 'https://www.bilibili.com')
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !/(^|\.)(hdslb\.com|bilibili\.com)$/.test(url.hostname)
    ) {
      return ''
    }
    url.protocol = 'https:'
    return url.href
  } catch {
    return ''
  }
}

const request = async (url: string, signal: AbortSignal): Promise<ApiObject> => {
  let response: Response
  try {
    response = await fetch(url, { credentials: 'include', signal, redirect: 'error' })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new FollowingApiError('无法连接 B 站，请稍后重试。', 'network')
  }
  if (!response.ok) {
    throw new FollowingApiError(`B 站请求失败（HTTP ${response.status}），请稍后重试。`, 'network')
  }
  let json: ApiObject
  try {
    json = object(await response.json())
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new FollowingApiError('B 站返回的数据无法读取，请稍后重试。', 'format')
  }
  if (json.code === -101) {
    throw new FollowingApiError('请先登录 B 站，再刷新关注首页。', 'login', json.code)
  }
  if (json.code !== 0) {
    throw new FollowingApiError(
      `关注内容暂时无法读取${Number.isFinite(json.code) ? `（${json.code}）` : ''}，请稍后重试。`,
      'api',
      Number.isFinite(json.code) ? json.code : undefined,
    )
  }
  return object(json.data)
}

// Memory only, scoped to the signed-in account. Never persist a following list or session cookie.
const relations = new Map<string, { followed: boolean; expires: number }>()
let relationAccount = ''
const isFollowing = async (author: ApiObject, accountId: string, signal: AbortSignal) => {
  if (typeof author.following === 'boolean') {
    return author.following
  }
  if (author.following === 0 || author.following === 1) {
    return author.following === 1
  }
  const mid = id(author.mid)
  const key = `${accountId}:${mid}`
  const cached = relations.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.followed
  }
  // Existing project API also used by subscribe-time-show; attributes 2 and 6 include following.
  const data = await request(`https://api.bilibili.com/x/web-interface/relation?mid=${mid}`, signal)
  const attribute = Number(object(data.relation).attribute)
  if (![0, 1, 2, 6, 128].includes(attribute)) {
    throw new FollowingApiError('无法确认关注关系，请稍后重试。', 'format')
  }
  const followed = attribute === 2 || attribute === 6
  if (relations.size >= 1_000) {
    relations.clear()
  }
  relations.set(key, { followed, expires: Date.now() + 60_000 })
  return followed
}

const durationSeconds = (value: unknown) => {
  const parts = text(value).split(':')
  if (parts.length > 3 || !parts.every(part => /^\d+$/.test(part))) {
    return 0
  }
  return parts.reduce((duration, part) => duration * 60 + Number(part), 0)
}
const postTypes = new Set([
  'DYNAMIC_TYPE_WORD',
  'DYNAMIC_TYPE_DRAW',
  'DYNAMIC_TYPE_ARTICLE',
  'DYNAMIC_TYPE_OPUS',
])

const parseItem = (raw: ApiObject): FollowingItem | undefined => {
  const modules = object(raw.modules)
  const author = object(modules.module_author)
  const dynamic = object(modules.module_dynamic)
  const major = object(dynamic.major)
  const description = object(dynamic.desc)
  const itemId = id(raw.id_str)
  const authorId = id(author.mid)
  const timestamp = positiveNumber(author.pub_ts) * 1000
  if (!itemId || !authorId || !timestamp) {
    return undefined
  }
  const base = {
    id: itemId,
    timestamp,
    author: { id: authorId, name: text(author.name) || 'UP 主', face: imageUrl(author.face) },
    text: text(description.text),
    images: [] as string[],
  }
  if (raw.type === 'DYNAMIC_TYPE_AV' && major.type === 'MAJOR_TYPE_ARCHIVE') {
    const archive = object(major.archive)
    const bvid = text(archive.bvid)
    if (!/^BV[a-zA-Z0-9]{10}$/.test(bvid)) {
      return undefined
    }
    return {
      ...base,
      kind: 'video',
      title: text(archive.title) || '查看视频',
      url: `https://www.bilibili.com/video/${bvid}/`,
      video: {
        bvid,
        aid: positiveNumber(archive.aid),
        cover: imageUrl(archive.cover),
        duration: durationSeconds(archive.duration_text),
        playCount: String(object(archive.stat).play ?? ''),
      },
    }
  }
  if (!postTypes.has(raw.type)) {
    return undefined
  }
  const opus = object(major.opus)
  const article = object(major.article)
  const draw = object(major.draw)
  const images = [
    ...(Array.isArray(opus.pics) ? opus.pics.map(pic => object(pic).url) : []),
    ...(Array.isArray(draw.items) ? draw.items.map(pic => object(pic).src) : []),
    ...(Array.isArray(article.covers) ? article.covers : []),
  ]
  return {
    ...base,
    kind: 'post',
    text: base.text || text(object(opus.summary).text) || text(article.desc),
    title: text(opus.title) || text(article.title),
    images: [...new Set(images.map(imageUrl).filter(Boolean))],
    url: `https://t.bilibili.com/${itemId}`,
  }
}

/** One cursor page only. The caller controls loading more and must reset on account changes. */
export const fetchFollowingPage = async (
  offset = '',
  signal?: AbortSignal,
): Promise<FollowingPage> => {
  const accountId = id(getUID())
  if (!accountId) {
    throw new FollowingApiError('请先登录 B 站，再刷新关注首页。', 'login')
  }
  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError')
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 20_000)
  try {
    const nav = await request('https://api.bilibili.com/x/web-interface/nav', controller.signal)
    if (!nav.isLogin) {
      throw new FollowingApiError('请先登录 B 站，再刷新关注首页。', 'login')
    }
    if (id(nav.mid) !== accountId || id(getUID()) !== accountId) {
      throw new FollowingApiError('登录账号已变化，请刷新关注首页。', 'account-changed')
    }
    if (relationAccount !== accountId || !offset) {
      relations.clear()
      relationAccount = accountId
    }
    const data = await request(getFeedsUrl('all', offset), controller.signal)
    const hasMore = data.has_more === true || data.has_more === 1
    if ((!Array.isArray(data.items) && (data.items != null || hasMore)) || data.items?.length > 100) {
      throw new FollowingApiError('关注动态的数据格式已变化，请稍后重试。', 'format')
    }
    const nextOffset = text(data.offset)
    if (hasMore && (!nextOffset || nextOffset === offset)) {
      throw new FollowingApiError('B 站未返回下一页位置，请刷新关注首页。', 'format')
    }
    const candidates: { raw: ApiObject; item: FollowingItem }[] = []
    for (const value of data.items ?? []) {
      const raw = object(value)
      const modules = object(raw.modules)
      // Reposts and promotion inserts must not bring non-followed creators into this view.
      if (raw.orig || raw.type === 'DYNAMIC_TYPE_FORWARD' || raw.is_ad || modules.module_ad) {
        continue
      }
      const item = parseItem(raw)
      if (item && item.author.id !== accountId) {
        candidates.push({ raw, item })
      }
    }
    const authors = new Map<string, ApiObject>()
    candidates.forEach(({ raw, item }) => {
      authors.set(item.author.id, object(object(raw.modules).module_author))
    })
    const authorEntries = [...authors.entries()]
    const followed = new Set<string>()
    let next = 0
    // Bounded concurrency only for authors whose dynamic response lacks a following flag.
    await Promise.all(
      Array.from({ length: Math.min(3, authorEntries.length) }, async () => {
        while (next < authorEntries.length) {
          const [mid, author] = authorEntries[next++]
          if (await isFollowing(author, accountId, controller.signal)) {
            followed.add(mid)
          }
        }
      }),
    )
    if (id(getUID()) !== accountId) {
      throw new FollowingApiError('登录账号已变化，请刷新关注首页。', 'account-changed')
    }
    const items = [...new Map(
      candidates.filter(({ item }) => followed.has(item.author.id)).map(({ item }) => [item.id, item]),
    ).values()].sort((a, b) => b.timestamp - a.timestamp)
    return { accountId, items, offset: nextOffset, hasMore }
  } catch (error) {
    if (timedOut) {
      throw new FollowingApiError('读取关注内容超时，请稍后重试。', 'timeout')
    }
    if (signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError')
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.abort()
  }
}
