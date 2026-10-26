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
  /** A missing or unsupported body must remain retryable rather than look like an empty post. */
  postContentStatus?: 'resolved' | 'unavailable'
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
/** Feed and opus detail responses use both keyed modules and module arrays. */
const modulesOf = (value: unknown): ApiObject => {
  return Array.isArray(value)
    ? Object.assign({}, ...value.map(module => object(module)))
    : object(value)
}
const longestText = (...values: string[]) => values.reduce(
  (longest, value) => value.length > longest.length ? value : longest, '',
)
/** Read known text fields only; neither HTML nor unrelated metadata becomes post content. */
const richText = (value: unknown, depth = 0): string => {
  if (depth > 12) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(node => richText(node, depth + 1)).join('')
  }
  if (!value || typeof value !== 'object') {
    return ''
  }
  const content = object(value)
  const read = (field: unknown) => richText(field, depth + 1)
  const paragraphs = Array.isArray(content.paragraphs)
    ? content.paragraphs.map(paragraph => read(object(paragraph).text)).filter(Boolean).join('\n\n')
    : ''
  return longestText(
    read(content.orig_text),
    read(content.text),
    read(content.words),
    read(content.word),
    read(content.rich),
    read(content.rich_text_nodes),
    read(content.nodes),
    paragraphs,
  )
}
/** Explicit empty text is valid for an image-only post; an unknown schema is not. */
const hasTextRepresentation = (value: unknown, depth = 0): boolean => {
  if (depth > 12) {
    return false
  }
  if (typeof value === 'string') {
    return true
  }
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(node => hasTextRepresentation(node, depth + 1))
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  const content = object(value)
  return ['orig_text', 'text', 'words', 'word', 'rich'].some(
    key => hasTextRepresentation(content[key], depth + 1),
  ) || ['rich_text_nodes', 'nodes'].some(
    key => Array.isArray(content[key]) && (
      content[key].length === 0 || hasTextRepresentation(content[key], depth + 1)
    ),
  )
}
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
  const modules = modulesOf(raw.modules)
  const author = object(modules.module_author)
  const dynamic = object(modules.module_dynamic)
  const content = object(modules.module_content)
  const major = object(dynamic.major ?? content.major)
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
    text: longestText(richText(dynamic.desc), richText(content.desc)),
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
  // Opus detail may include both module_dynamic (summary) and module_content (full body).
  // Keep both instead of treating them as aliases and losing the full paragraphs.
  const paragraphGroups = [
    dynamic.paragraphs,
    content.paragraphs,
    opus.paragraphs,
    object(opus.content).paragraphs,
  ].filter(Array.isArray) as unknown[][]
  const paragraphs = paragraphGroups.flat()
  const paragraphText = longestText(...paragraphGroups.map(group => group
    .map(value => richText(object(value).text))
    .filter(Boolean)
    .join('\n\n')))
  const album = object(object(object(modules.module_top).display).album)
  const images = [
    ...(Array.isArray(album.pics) ? album.pics.map(pic => object(pic).url) : []),
    ...paragraphs.flatMap(value => {
      const pics = object(object(value).pic).pics
      return Array.isArray(pics) ? pics.map(pic => object(pic).url) : []
    }),
    ...(Array.isArray(opus.pics) ? opus.pics.map(pic => object(pic).url) : []),
    ...(Array.isArray(draw.items) ? draw.items.map(pic => object(pic).src) : []),
    ...(Array.isArray(article.covers) ? article.covers : []),
  ]
  const body = longestText(
    base.text,
    richText(opus.summary),
    richText(opus.content),
    richText(article.desc),
    richText(content.text),
    paragraphText,
  )
  const imageOnlyParagraphs = paragraphGroups.some(group =>
    group.length > 0 && group.every(value => Number(object(value).para_type) === 2),
  )
  const knownBody = [dynamic.desc, content.desc, opus.summary, article.desc, content.text]
    .some(value => hasTextRepresentation(value))
  const postImages = [...new Set(images.map(imageUrl).filter(Boolean))]
  const unsupportedTextParagraph = paragraphs.some(value => {
    const paragraph = object(value)
    return Number(paragraph.para_type) === 1 && !hasTextRepresentation(paragraph.text)
  })
  const imageOnlyBody = postImages.length > 0 && (knownBody || imageOnlyParagraphs) &&
    !unsupportedTextParagraph
  return {
    ...base,
    kind: 'post',
    text: body,
    title: richText(opus.title) || richText(article.title) || richText(modules.module_title),
    images: postImages,
    url: `https://t.bilibili.com/${itemId}`,
    postContentStatus: body || imageOnlyBody ? 'resolved' : 'unavailable',
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
      const modules = modulesOf(raw.modules)
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
      authors.set(item.author.id, object(modulesOf(raw.modules).module_author))
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

/** Fetch expanded post content only after the user opens the posts tab. */
export const fetchFollowingPostDetail = async (
  item: FollowingItem,
  accountId: string,
  signal?: AbortSignal,
): Promise<FollowingItem> => {
  if (item.kind !== 'post' || !accountId || id(getUID()) !== accountId) {
    throw new FollowingApiError('登录账号已变化，请刷新关注首页。', 'account-changed')
  }
  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError')
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, 12_000)
  try {
    const data = await request(
      `https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${item.id}`,
      controller.signal,
    )
    if (id(getUID()) !== accountId) {
      throw new FollowingApiError('登录账号已变化，请刷新关注首页。', 'account-changed')
    }
    const raw = object(data.item)
    const modules = modulesOf(raw.modules)
    const author = object(modules.module_author)
    if (id(raw.id_str) !== item.id || id(author.mid) !== item.author.id || raw.orig) {
      throw new FollowingApiError('正文暂时无法读取，请打开原帖。', 'format')
    }
    const detail = parseItem({
      ...raw,
      modules: {
        ...modules,
        module_author: { ...author, pub_ts: positiveNumber(author.pub_ts) || item.timestamp / 1000 },
      },
    })
    if (!detail || detail.kind !== 'post') {
      throw new FollowingApiError('正文暂时无法读取，请打开原帖。', 'format')
    }
    return {
      ...item,
      title: detail.title || item.title,
      text: longestText(item.text, detail.text),
      images: [...new Set([...detail.images, ...item.images])],
      postContentStatus: detail.postContentStatus,
    }
  } catch (error) {
    if (timedOut) {
      throw new FollowingApiError('读取正文超时，可重试或打开原帖。', 'timeout')
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.abort()
  }
}
