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
  /** Original image dimensions reserve space before the image request finishes. */
  imageSizes?: Record<string, { width: number; height: number }>
  url: string
  /** Explicit access labels from Bilibili's badge or paywall metadata, never title keywords. */
  accessBadge?: string
  /** Native interactive lottery only; an ordinary topic with the same text is not a lottery. */
  lottery?: { id: string; dynamicId: string; nativeUrl?: string }
  /** Summaries and unsupported bodies remain retryable; resolved requires full paragraph data. */
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
  if (!Array.isArray(value)) {
    return object(value)
  }
  // Each Opus module may include null placeholders for every other module type.
  // Merging those placeholders overwrites the author/body already found earlier.
  return Object.fromEntries(
    value.flatMap(module =>
      Object.entries(object(module)).filter(
        ([key, entry]) => key !== 'module_type' && entry != null,
      ),
    ),
  )
}
const longestText = (...values: string[]) =>
  values.reduce((longest, value) => (value.length > longest.length ? value : longest), '')
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
    ? content.paragraphs
        .map(paragraph => read(object(paragraph).text))
        .filter(Boolean)
        .join('\n\n')
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
  return (
    ['orig_text', 'text', 'words', 'word', 'rich'].some(key =>
      hasTextRepresentation(content[key], depth + 1),
    ) ||
    ['rich_text_nodes', 'nodes'].some(
      key =>
        Array.isArray(content[key]) &&
        (content[key].length === 0 || hasTextRepresentation(content[key], depth + 1)),
    )
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

/** Keep the site's own access labels without treating a creator's title as an access rule. */
const accessBadgeOf = (
  raw: ApiObject,
  modules: ApiObject,
  major: ApiObject,
): string | undefined => {
  const blocked = object(major.blocked ?? modules.module_blocked)
  const candidates = [
    object(object(major.archive).badge).text,
    object(modules.module_tag).text,
    blocked.title,
    blocked.hint_message,
  ]
  for (const value of candidates) {
    const label = text(value).trim()
    if (label && label.length <= 48 && /充电|专属|付费/.test(label)) {
      return label
    }
  }
  if (object(raw.basic).is_only_fans === true) {
    return '充电专属'
  }
  // A paywall module is an explicit content restriction; do not label ordinary charge buttons.
  if (Object.keys(object(modules.module_paywall)).length > 0) {
    return '付费内容'
  }
  return undefined
}

/** Only traverse body containers used by dynamic/Opus rich text, not arbitrary string fields. */
const lotteryNodeId = (value: unknown, depth = 0): string => {
  if (depth > 12 || !value || typeof value !== 'object') {
    return ''
  }
  if (Array.isArray(value)) {
    for (const node of value) {
      const lotteryId = lotteryNodeId(node, depth + 1)
      if (lotteryId) {
        return lotteryId
      }
    }
    return ''
  }
  const node = object(value)
  if (node.type === 'RICH_TEXT_NODE_TYPE_LOTTERY') {
    return id(node.rid)
  }
  for (const key of ['rich_text_nodes', 'nodes', 'rich', 'text', 'paragraphs']) {
    const lotteryId = lotteryNodeId(node[key], depth + 1)
    if (lotteryId) {
      return lotteryId
    }
  }
  return ''
}
/** The native Opus popup embeds this page; business_id is the dynamic id, not the lottery rid. */
const nativeLotteryUrl = (value: unknown, dynamicId: string): string | undefined => {
  try {
    const url = new URL(text(value), 'https://www.bilibili.com')
    if (
      url.origin !== 'https://www.bilibili.com' ||
      url.pathname !== '/h5/lottery/result' ||
      url.searchParams.get('business_id') !== dynamicId ||
      !['1', '12'].includes(url.searchParams.get('business_type'))
    ) {
      return undefined
    }
    const result = new URL('https://www.bilibili.com/h5/lottery/result')
    result.searchParams.set('business_type', url.searchParams.get('business_type'))
    result.searchParams.set('business_id', dynamicId)
    result.searchParams.set('isWeb', '1')
    return result.href
  } catch {
    return undefined
  }
}
const lotteryOf = (
  modules: ApiObject,
  major: ApiObject,
  dynamicId: string,
): FollowingItem['lottery'] => {
  const dynamic = object(modules.module_dynamic)
  const content = object(modules.module_content)
  const opus = object(major.opus)
  // Prefer an explicit charge-lottery card over its accompanying text node: the site's URL
  // retains its business type, whereas ordinary interactive rich text always uses type 1.
  const cards: ApiObject[] = []
  const additional = object(dynamic.additional)
  if (additional.type === 'ADDITIONAL_TYPE_UPOWER_LOTTERY') {
    cards.push(object(additional.upower_lottery))
  }
  if (Array.isArray(content.paragraphs)) {
    for (const paragraph of content.paragraphs) {
      const card = object(object(object(paragraph).link_card).card)
      if (card.type === 'LINK_CARD_TYPE_UPOWER_LOTTERY') {
        cards.push(object(card.upower_lottery))
      }
    }
  }
  for (const card of cards) {
    const lotteryId = id(card.rid)
    if (lotteryId) {
      return {
        id: lotteryId,
        dynamicId,
        nativeUrl: nativeLotteryUrl(card.jump_url ?? object(card.desc).jump_url, dynamicId),
      }
    }
  }
  for (const body of [dynamic.desc, content.desc, content, opus.summary, opus.content]) {
    const lotteryId = lotteryNodeId(body)
    if (lotteryId) {
      return {
        id: lotteryId,
        dynamicId,
        nativeUrl: nativeLotteryUrl(
          `https://www.bilibili.com/h5/lottery/result?business_type=1&business_id=${dynamicId}`,
          dynamicId,
        ),
      }
    }
  }
  return undefined
}

const parseItem = (raw: ApiObject): FollowingItem | undefined => {
  const modules = modulesOf(raw.modules)
  const author = object(modules.module_author)
  const dynamic = object(modules.module_dynamic)
  const content = object(modules.module_content)
  const major = object(dynamic.major ?? content.major)
  const itemId = id(raw.id_str)
  const authorId = id(author.mid)
  const timestamp = positiveNumber(author.pub_ts) * 1000
  if (!itemId || !authorId || !timestamp || !Number.isFinite(new Date(timestamp).getTime())) {
    return undefined
  }
  const base = {
    id: itemId,
    timestamp,
    author: { id: authorId, name: text(author.name) || 'UP 主', face: imageUrl(author.face) },
    text: longestText(richText(dynamic.desc), richText(content.desc)),
    images: [] as string[],
    accessBadge: accessBadgeOf(raw, modules, major),
    lottery: lotteryOf(modules, major, itemId),
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
  const paragraphText = longestText(
    ...paragraphGroups.map(group =>
      group
        .map(value => richText(object(value).text))
        .filter(Boolean)
        .join('\n\n'),
    ),
  )
  const album = object(object(object(modules.module_top).display).album)
  const images = [
    ...(Array.isArray(album.pics) ? album.pics : []),
    ...paragraphs.flatMap(value => {
      const { pics } = object(object(value).pic)
      return Array.isArray(pics) ? pics : []
    }),
    ...(Array.isArray(opus.pics) ? opus.pics : []),
    ...(Array.isArray(draw.items) ? draw.items : []),
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
  const imageSizes: NonNullable<FollowingItem['imageSizes']> = {}
  const postImages = [
    ...new Set(
      images
        .map(value => {
          const picture = object(value)
          const url = imageUrl(typeof value === 'string' ? value : picture.url ?? picture.src)
          const width = positiveNumber(picture.width)
          const height = positiveNumber(picture.height)
          if (url && width && height && width <= 100000 && height <= 100000) {
            imageSizes[url] = { width, height }
          }
          return url
        })
        .filter(Boolean),
    ),
  ]
  // Opus summary/desc is not proof of a complete body, even when nonempty. Only a
  // structured full-content module can finish expansion; unknown paragraph kinds stay retryable.
  const fullParagraphs = content.paragraphs
  const completeBody =
    Array.isArray(fullParagraphs) &&
    (fullParagraphs.length > 0 || !body.trim()) &&
    fullParagraphs.every(value => {
      const paragraph = object(value)
      if (Number(paragraph.para_type) === 1) {
        return hasTextRepresentation(paragraph.text)
      }
      if (Number(paragraph.para_type) === 2) {
        return Array.isArray(object(paragraph.pic).pics)
      }
      return false
    }) &&
    Object.keys(object(modules.module_paywall)).length === 0 &&
    Object.keys(object(modules.module_blocked)).length === 0 &&
    Object.keys(object(major.blocked)).length === 0
  return {
    ...base,
    kind: 'post',
    text: body,
    title: richText(opus.title) || richText(article.title) || richText(modules.module_title),
    images: postImages,
    imageSizes,
    url: `https://t.bilibili.com/${itemId}`,
    postContentStatus: completeBody ? 'resolved' : 'unavailable',
  }
}

/** Extract the site's JSON state without evaluating any code from the original post. */
const initialPostState = (html: string): ApiObject | undefined => {
  const scripts = html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)
  for (const [, script] of scripts) {
    const assignment = /^\s*window\.__INITIAL_STATE__\s*=\s*/.exec(script)
    if (!assignment || script[assignment[0].length] !== '{') {
      continue
    }
    const start = assignment[0].length
    let depth = 0
    let quoted = false
    let escaped = false
    for (let index = start; index < script.length; index++) {
      const character = script[index]
      if (quoted) {
        if (escaped) {
          escaped = false
        } else if (character === '\\') {
          escaped = true
        } else if (character === '"') {
          quoted = false
        }
        continue
      }
      if (character === '"') {
        quoted = true
      } else if (character === '{' || character === '[') {
        depth++
      } else if (character === '}' || character === ']') {
        depth--
        if (depth === 0) {
          try {
            return object(JSON.parse(script.slice(start, index + 1)))
          } catch {
            return undefined
          }
        }
      }
    }
  }
  return undefined
}

/** Read the same post's server-rendered Opus data when the dynamic API omits its text. */
const fetchOriginalPost = async (
  item: FollowingItem,
  accountId: string,
  signal: AbortSignal,
): Promise<FollowingItem | undefined> => {
  const response = await fetch(`https://www.bilibili.com/opus/${item.id}`, {
    credentials: 'include',
    signal,
    redirect: 'error',
  })
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
    return undefined
  }
  const html = await response.text()
  if (signal.aborted) {
    throw new DOMException('Request aborted', 'AbortError')
  }
  if (id(getUID()) !== accountId) {
    throw new FollowingApiError('登录账号已变化，请刷新关注首页。', 'account-changed')
  }
  if (html.length > 4_000_000) {
    return undefined
  }
  const state = initialPostState(html)
  const raw = object(state?.detail)
  const modules = modulesOf(raw.modules)
  const author = object(modules.module_author)
  if (
    id(state?.id) !== item.id ||
    id(raw.id_str) !== item.id ||
    id(author.mid) !== item.author.id ||
    raw.orig
  ) {
    return undefined
  }
  // The Opus page uses numeric type values, unlike the dynamic API's string enum.
  return parseItem({
    ...raw,
    type: 'DYNAMIC_TYPE_OPUS',
    modules: {
      ...modules,
      module_author: { ...author, pub_ts: positiveNumber(author.pub_ts) || item.timestamp / 1000 },
    },
  })
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
    if (
      (!Array.isArray(data.items) && (data.items != null || hasMore)) ||
      data.items?.length > 100
    ) {
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
    const items = [
      ...new Map(
        candidates
          .filter(({ item }) => followed.has(item.author.id))
          .map(({ item }) => [item.id, item]),
      ).values(),
    ].sort((a, b) => b.timestamp - a.timestamp)
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
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 20_000)
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
    let detail = parseItem({
      ...raw,
      modules: {
        ...modules,
        module_author: {
          ...author,
          pub_ts: positiveNumber(author.pub_ts) || item.timestamp / 1000,
        },
      },
    })
    if (!detail || detail.kind !== 'post') {
      throw new FollowingApiError('正文暂时无法读取，请打开原帖。', 'format')
    }
    if (detail.postContentStatus !== 'resolved') {
      try {
        const original = await fetchOriginalPost(item, accountId, controller.signal)
        if (original) {
          detail = {
            ...detail,
            text: longestText(detail.text, original.text),
            title: original.title || detail.title,
            images: [...new Set([...original.images, ...detail.images])],
            imageSizes: { ...detail.imageSizes, ...original.imageSizes },
            accessBadge: original.accessBadge || detail.accessBadge,
            lottery: original.lottery || detail.lottery,
            postContentStatus:
              original.postContentStatus === 'resolved' ? 'resolved' : 'unavailable',
          }
        }
      } catch (error) {
        if (controller.signal.aborted || id(getUID()) !== accountId) {
          throw error
        }
        // Keep the API's images and explicit unavailable state; the UI offers retry/original post.
      }
    }
    const body = longestText(item.text, detail.text)
    return {
      ...item,
      title: detail.title || item.title,
      text: body,
      images: [...new Set([...detail.images, ...item.images])],
      imageSizes: { ...item.imageSizes, ...detail.imageSizes },
      accessBadge: detail.accessBadge || item.accessBadge,
      lottery: detail.lottery || item.lottery,
      postContentStatus:
        detail.postContentStatus === 'resolved' || item.postContentStatus === 'resolved'
          ? 'resolved'
          : 'unavailable',
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
