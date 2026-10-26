import { getUID } from '@/core/utils'

export interface RecommendedVideo {
  bvid: string
  aid: number
  cid: number
  title: string
  authorId: string
  authorName: string
  cover: string
  duration: number
  portrait: boolean
}

export interface RecommendationBatch {
  items: RecommendedVideo[]
  filtered: number
  unavailable: number
}

interface RecommendationExclusions {
  authors?: Set<string>
  videos?: Set<string>
}

const apiRoot = 'https://api.bilibili.com'
const requestTimeout = 12_000
const candidateLimit = 6
const dramaPattern = /短剧|短劇|微剧|微劇|爽剧|爽劇|竖屏剧|竪屏劇|竖屏短|甜宠剧|甜寵劇|霸总剧|霸總劇|mini[ -]?drama|short[ -]?drama/i
const metadataCache = new Map<string, RecommendedVideo | null>()

export const getRecommendationAccount = () => String(getUID() || '')

const apiRequest = async (path: string, accountId: string, signal?: AbortSignal) => {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', abort, { once: true })
  }
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, requestTimeout)
  try {
    if (accountId !== getRecommendationAccount()) {
      throw new Error('登录账号已变化，请关闭短视频模式后重新打开。')
    }
    const response = await fetch(`${apiRoot}${path}`, {
      credentials: 'include',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`B 站推荐请求失败（HTTP ${response.status}），请稍后重试。`)
    }
    const json = await response.json()
    if (accountId !== getRecommendationAccount()) {
      throw new Error('登录账号已变化，请关闭短视频模式后重新打开。')
    }
    if (json.code !== 0) {
      throw Object.assign(new Error(`B 站暂未返回可用内容（${json.code}），请稍后重试。`), {
        code: json.code,
      })
    }
    return json.data
  } catch (error) {
    if (timedOut) {
      throw new Error('B 站推荐请求超时，请稍后重试。')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

const positiveFlag = (value: unknown) => value === true || value === 1 || value === '1'
const hasAd = (item: any) =>
  positiveFlag(item.is_ad) ||
  positiveFlag(item.is_ad_loc) ||
  Boolean(item.ad_info || item.business_info || item.advertisement) ||
  /广告|廣告|推广|推廣/.test(
    [item.rcmd_reason?.content, item.badge?.text, item.badge, item.ad_tag].filter(
      value => typeof value === 'string',
    ).join(' '),
  )

const safeImage = (value: unknown) => {
  if (typeof value !== 'string') {
    return ''
  }
  try {
    const url = new URL(value, 'https://www.bilibili.com')
    if (!['https:', 'http:'].includes(url.protocol) || !/(^|\.)hdslb\.com$/.test(url.hostname)) {
      return ''
    }
    url.protocol = 'https:'
    return url.href
  } catch {
    return ''
  }
}

const remember = (bvid: string, video: RecommendedVideo | null) => {
  metadataCache.set(bvid, video)
  if (metadataCache.size > 120) {
    metadataCache.delete(metadataCache.keys().next().value)
  }
  return video
}

const resolveCandidate = async (
  candidate: any,
  accountId: string,
  signal?: AbortSignal,
): Promise<RecommendedVideo | null> => {
  const { bvid } = candidate
  if (metadataCache.has(bvid)) {
    return metadataCache.get(bvid)
  }
  const view = await apiRequest(`/x/web-interface/view?bvid=${bvid}`, accountId, signal)
  if (
    !view ||
    view.bvid !== bvid ||
    !Number.isSafeInteger(view.aid) ||
    !Number.isSafeInteger(view.cid) ||
    !view.owner?.mid ||
    view.redirect_url ||
    dramaPattern.test([view.title, view.desc, view.tname, view.ugc_season?.title].join(' '))
  ) {
    return remember(bvid, null)
  }
  const tags = await apiRequest(
    `/x/web-interface/view/detail/tag?aid=${view.aid}&cid=${view.cid}`,
    accountId,
    signal,
  )
  if (!Array.isArray(tags)) {
    throw new Error('视频标签暂时不可用，请稍后重试。')
  }
  if (tags.some(tag => dramaPattern.test(String(tag.tag_name || '')))) {
    return remember(bvid, null)
  }
  const dimension = view.dimension || view.pages?.[0]?.dimension
  return remember(bvid, {
    bvid,
    aid: view.aid,
    cid: view.cid,
    title: String(view.title || candidate.title || '视频'),
    authorId: String(view.owner.mid),
    authorName: String(view.owner.name || ''),
    cover: safeImage(view.pic),
    duration: Number(view.duration) || 0,
    portrait: Number(dimension?.height) > Number(dimension?.width),
  })
}

/** Read Bilibili's web recommendations without changing the server-side recommendation model. */
export const fetchRecommendations = async (
  page = 1,
  signal?: AbortSignal,
  exclusions: RecommendationExclusions = {},
): Promise<RecommendationBatch> => {
  const accountId = getRecommendationAccount()
  if (!accountId) {
    throw new Error('请先登录 B 站，再打开短视频模式。')
  }
  const params = new URLSearchParams({
    fresh_type: '3',
    ps: '12',
    fresh_idx: String(page),
    fresh_idx_1h: String(page),
    feed_version: 'V8',
  })
  const data = await apiRequest(`/x/web-interface/index/top/feed/rcmd?${params}`, accountId, signal)
  if (!Array.isArray(data?.item)) {
    throw new Error('B 站推荐数据格式已变化，请切回原版精简模式。')
  }
  let filtered = 0
  let unavailable = 0
  const seen = new Set<string>()
  const candidates = data.item.filter((item: any) => {
    const allowed =
      item.goto === 'av' &&
      /^BV[a-zA-Z0-9]{10}$/.test(item.bvid || '') &&
      !hasAd(item) &&
      !dramaPattern.test([item.title, item.tname, item.rcmd_reason?.content].join(' ')) &&
      !exclusions.authors?.has(String(item.owner?.mid)) &&
      !exclusions.videos?.has(item.bvid) &&
      !seen.has(item.bvid)
    seen.add(item.bvid)
    if (!allowed) {
      filtered += 1
    }
    return allowed
  }).slice(0, candidateLimit)
  const results: Array<RecommendedVideo | null> = new Array(candidates.length).fill(null)
  let cursor = 0
  const worker = async () => {
    while (cursor < candidates.length) {
      const index = cursor
      cursor += 1
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      try {
        const video = await resolveCandidate(candidates[index], accountId, signal)
        if (video && !exclusions.authors?.has(video.authorId)) {
          results[index] = video
        } else {
          filtered += 1
        }
      } catch (error) {
        if (error?.code === -404 || error?.code === 62002 || error?.code === 62012) {
          unavailable += 1
        } else {
          throw error
        }
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return {
    items: results.filter((item): item is RecommendedVideo => item !== null),
    filtered,
    unavailable,
  }
}
