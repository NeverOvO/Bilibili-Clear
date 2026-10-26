import { getCsrf, getUID } from '@/core/utils'
import { watchlaterList } from '@/components/video/watchlater'

export interface WatchlaterSnapshot {
  count: number
  aids: number[]
}
export interface WatchlaterBatchResult {
  added: number[]
  existing: number[]
  failed: { aid: number; message: string }[]
  cancelled: boolean
}
class WatchlaterError extends Error {
  constructor(message: string, public stopBatch = false) { super(message) }
}
const requireAccount = (expected?: string) => {
  const uid = getUID() || ''
  if (!uid) { throw new WatchlaterError('请登录 B 站后使用稍后再看。', true) }
  if (expected && uid !== expected) { throw new WatchlaterError('登录账号已变化，请刷新页面后操作。', true) }
  return uid
}
const abortError = () => new DOMException('操作已取消', 'AbortError')
const request = async (path: string, uid: string, signal?: AbortSignal, body?: URLSearchParams) => {
  requireAccount(uid)
  if (signal?.aborted) { throw abortError() }
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, 12000)
  try {
    const response = await fetch(`https://api.bilibili.com/x/v2/history/toview/${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'include',
      signal: controller.signal,
      ...(body ? { body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : {}),
    })
    requireAccount(uid)
    if (!response.ok) {
      throw new WatchlaterError(`稍后再看请求失败（HTTP ${response.status}），请稍后重试。`, true)
    }
    const json = await response.json()
    if (json?.code !== 0) {
      const detail = typeof json?.message === 'string' ? json.message : '请稍后重试'
      throw new WatchlaterError(`稍后再看操作失败：${detail}`, [-101, -111, -352, -412, -509].includes(json?.code) || /上限|已满|频繁|登录|验证/.test(detail))
    }
    return json.data
  } catch (error) {
    if (signal?.aborted) { throw abortError() }
    if (timedOut) { throw new WatchlaterError(body ? '添加请求超时，结果未确认；刷新稍后再看数量后可重试。' : '读取稍后再看超时，请重试。', true) }
    if (error instanceof WatchlaterError) { throw error }
    throw new WatchlaterError(body ? '添加请求中断，结果未确认；刷新数量后可重试。' : '无法读取稍后再看，请重试。', true)
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
export const fetchWatchlater = async (signal?: AbortSignal): Promise<WatchlaterSnapshot> => {
  const uid = requireAccount()
  const data = await request('web', uid, signal)
  requireAccount(uid)
  if (!data || (data.list != null && !Array.isArray(data.list)) || (data.list == null && Number(data.count) !== 0)) {
    throw new WatchlaterError('稍后再看列表格式变化，请打开原版页面查看。', true)
  }
  const aids: number[] = [...new Set<number>((data.list || []).map((item: any) => Number(item?.aid)).filter((aid: number) => Number.isSafeInteger(aid) && aid > 0))]
  const count = Number(data.count)
  watchlaterList.splice(0, watchlaterList.length, ...aids)
  return { aids, count: Number.isSafeInteger(count) && count >= aids.length ? count : aids.length }
}
const pauseBetweenRequests = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(abortError()); return }
  const abort = () => { window.clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(abortError()) }
  // Native watch-later orders by addition time, with second-level timestamps. Keep each
  // addition in a separate second so a batch cannot fall back to an unstable tie order.
  const timer = window.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, 1100)
  signal?.addEventListener('abort', abort, { once: true })
})

/** A cover-button click needs only the add request, not a preceding full-list read. */
export const addWatchlaterVideo = async (aid: number, signal?: AbortSignal): Promise<void> => {
  const uid = requireAccount()
  if (!Number.isSafeInteger(aid) || aid <= 0) { throw new WatchlaterError('视频编号无效，请刷新后重试。') }
  const csrf = getCsrf()
  if (!csrf) { throw new WatchlaterError('登录凭据已失效，请重新登录后添加。', true) }
  await request('add', uid, signal, new URLSearchParams({ aid: String(aid), csrf }))
  requireAccount(uid)
  if (!watchlaterList.includes(aid)) { watchlaterList.push(aid) }
}

/** Only called by an explicit selection/day-add click. Never removes or clears existing entries. */
export const addWatchlaterBatch = async (
  videos: { aid: number; bvid: string; publishedAt: number }[],
  options: { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void; onAdded?: (aid: number) => void } = {},
): Promise<WatchlaterBatchResult> => {
  const result: WatchlaterBatchResult = { added: [], existing: [], failed: [], cancelled: false }
  const uid = requireAccount()
  const unique = [...new Map(videos.filter(video => Number.isSafeInteger(video.aid) && video.aid > 0).map(video => [video.aid, video])).values()]
  if (!unique.length) { return result }
  const snapshot = await fetchWatchlater(options.signal)
  requireAccount(uid)
  const existing = new Set(snapshot.aids)
  result.existing = unique.filter(video => existing.has(video.aid)).map(video => video.aid)
  // The original page defaults to "最近添加" (new additions first). Submit newer
  // publications first and older ones last, so this batch appears oldest first there.
  // Existing entries keep their original position; do not delete/re-add them to sort.
  const pending = unique.filter(video => !existing.has(video.aid)).sort((a, b) =>
    (Number(b.publishedAt) || 0) - (Number(a.publishedAt) || 0) || b.aid - a.aid,
  )
  for (let index = 0; index < pending.length; index++) {
    const video = pending[index]
    try {
      requireAccount(uid)
      if (index > 0) { await pauseBetweenRequests(options.signal) }
      const csrf = getCsrf()
      if (!csrf) { throw new WatchlaterError('登录凭据已失效，请重新登录后添加。', true) }
      await request('add', uid, options.signal, new URLSearchParams({ aid: String(video.aid), csrf }))
      result.added.push(video.aid)
      if (!watchlaterList.includes(video.aid)) { watchlaterList.push(video.aid) }
      options.onAdded?.(video.aid)
      options.onProgress?.(result.added.length + result.existing.length + result.failed.length, unique.length)
    } catch (error) {
      if (options.signal?.aborted) {
        result.cancelled = true
        result.failed.push(...pending.slice(index).map(item => ({ aid: item.aid, message: '操作已取消，请刷新列表确认添加结果。' })))
        break
      }
      const message = error instanceof Error ? error.message : '添加失败，请重试。'
      result.failed.push({ aid: video.aid, message })
      if (!(error instanceof WatchlaterError) || error.stopBatch) {
        result.failed.push(...pending.slice(index + 1).map(item => ({ aid: item.aid, message: '批量添加已停止，请稍后重试。' })))
        break
      }
    }
  }
  return result
}
