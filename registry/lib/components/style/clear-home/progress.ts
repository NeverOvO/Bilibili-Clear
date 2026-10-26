import { childListSubtree, urlChange, videoChange } from '@/core/observer'
import { dq, getUID } from '@/core/utils'

export interface WatchProgress {
  bvid: string
  cid?: number
  page?: number
  /** Number of parts, when the API supplies it. */
  pages?: number
  position: number
  duration: number
  /** The whole video is complete only when every part has completion evidence. */
  completed: boolean
  partCompleted?: boolean
  /** This sample reached the actual end, independently of the watched threshold. */
  playbackEnded?: boolean
  updatedAt: number
  source: 'local' | 'history'
}

interface SavedProgress extends WatchProgress {
  /** Completed page numbers and their cids; never store cookies or API response bodies. */
  completedParts: Record<string, number>
}
interface SavedState {
  version: 1
  records: SavedProgress[]
}
interface PlaybackTarget {
  key: string
  bvid?: string
  aid?: string
  cid: number
  page: number
}
interface PlaybackContext {
  key: string
  bvid: string
  cid: number
  page: number
  pages: number
}
interface HistoryCursor {
  max: number
  viewAt: number
  business: string
}
interface HistoryCoverage {
  newestAt: number
  oldestAt: number
  cursor?: HistoryCursor
  reachedEnd: boolean
}
export interface HistorySyncResult {
  extended: boolean
  fetchedPages: number
  /** Valid videos imported by this request, deduplicated by BV ID. */
  importedRecords: number
  /** Earliest view time covered in this page session; not a platform retention period. */
  oldestAt?: number
  reachedEnd: boolean
  reachedWindow: boolean
  limited: boolean
  /** Older imported entries would be evicted by the local 1000-video cap. */
  retentionLimited: boolean
}

const storagePrefix = 'bilibiliClear.watchProgress.v1.'
const maximumRecords = 1000
const historyPageLimit = 3
const extendedHistoryPageLimit = 30
const historyPageSize = 30
const historyWindow = 7 * 24 * 60 * 60 * 1000
const writeInterval = 8000
const bvidPattern = /^BV[0-9A-Za-z]{10}$/
const positiveInteger = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return 0
  }
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}
const accountID = () => {
  const uid = getUID()
  return /^\d+$/.test(uid ?? '') ? uid : ''
}
const abortError = () => new DOMException('操作已取消', 'AbortError')

/** A started part is complete at 95%, or with less than 30 seconds remaining. */
const reachesCompletion = (position: number, duration: number) =>
  Number.isFinite(position) && Number.isFinite(duration) && position > 0 && duration > 0 &&
  (position / duration >= 0.95 || duration - position < 30)


/** Fetch is used here because the shared XHR wrapper does not accept AbortSignal. */
const requestData = async <T>(url: string, signal: AbortSignal): Promise<T> => {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal.aborted) {
    throw abortError()
  }
  signal.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(abort, 12000)
  try {
    const response = await fetch(url, { credentials: 'include', signal: controller.signal })
    if (!response.ok) {
      throw new Error(`读取观看记录失败（HTTP ${response.status}）`)
    }
    const json = await response.json()
    if (json?.code !== 0 || !json.data) {
      throw new Error(json?.code === -101 ? '请登录 B 站后读取观看记录。' : 'B 站暂时无法提供观看记录，请稍后重试。')
    }
    return json.data as T
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) {
      throw new Error('读取观看记录超时，请稍后重试。')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

const sanitize = (value: any): SavedProgress | undefined => {
  if (
    !value ||
    !bvidPattern.test(value.bvid ?? '') ||
    !Number.isFinite(value.position) || value.position < 0 ||
    !Number.isFinite(value.duration) || value.duration < 0 ||
    !Number.isFinite(value.updatedAt) || value.updatedAt <= 0 ||
    value.updatedAt > Date.now() + 60000 ||
    !['local', 'history'].includes(value.source)
  ) {
    return undefined
  }
  const completedParts: Record<string, number> = {}
  Object.entries(value.completedParts ?? {}).slice(0, 1000).forEach(([page, cid]) => {
    if (positiveInteger(page) && positiveInteger(cid)) {
      completedParts[page] = Number(cid)
    }
  })
  const pages = positiveInteger(value.pages) || undefined
  const page = positiveInteger(value.page) || undefined
  const cid = positiveInteger(value.cid) || undefined
  // Reapply the current completion rule when reading old records as well as new samples.
  // Each part still needs its own identity before it can contribute to the whole video.
  if (page && cid && (value.partCompleted === true || reachesCompletion(value.position, value.duration))) {
    completedParts[String(page)] = cid
  }
  const completed = Boolean(pages && pages <= 1000 && Array.from(
    { length: pages }, (_, index) => completedParts[String(index + 1)],
  ).every(Boolean))
  return {
    bvid: value.bvid,
    cid,
    page,
    pages,
    position: value.position,
    duration: value.duration,
    completed,
    partCompleted: Boolean(page && cid && completedParts[String(page)] === cid),
    playbackEnded: value.playbackEnded === true || (value.duration > 0 && value.position >= value.duration),
    updatedAt: value.updatedAt,
    source: value.source,
    completedParts,
  }
}

const readStored = (uid: string): Map<string, SavedProgress> => {
  const result = new Map<string, SavedProgress>()
  if (!uid) {
    return result
  }
  const saved = GM_getValue(storagePrefix + uid, undefined) as SavedState | undefined
  if (saved?.version !== 1 || !Array.isArray(saved.records)) {
    return result
  }
  saved.records.slice(0, maximumRecords).forEach(value => {
    const record = sanitize(value)
    if (record) {
      result.set(record.bvid, record)
    }
  })
  return result
}

const mergeRecord = (first: SavedProgress | undefined, second: SavedProgress): SavedProgress => {
  if (!first) {
    return second
  }
  const newer = second.updatedAt >= first.updatedAt ? second : first
  const older = newer === second ? first : second
  const completedParts = { ...older.completedParts, ...newer.completedParts }
  // A replaced part must not inherit completion from a different cid.
  if (newer.page && newer.cid && completedParts[String(newer.page)] !== newer.cid) {
    delete completedParts[String(newer.page)]
  }
  const pages = newer.pages ?? older.pages
  return sanitize({ ...newer, pages, completedParts }) ?? newer
}

/** Account-local progress, plus bounded, cursor-based imports of Bilibili history. */
export const createProgressStore = () => {
  let uid = accountID()
  let records = readStored(uid)
  let disposed = false
  let trackingCleanup: (() => void) | undefined
  let historyController: AbortController | undefined
  // Only retain cursor metadata in memory. A fresh page starts from the current account's head.
  let historyCoverage: HistoryCoverage | undefined
  const subscribers = new Set<() => void>()
  const notify = () => subscribers.forEach(callback => callback())
  const ensureAccount = () => {
    const nextUID = accountID()
    if (nextUID !== uid) {
      historyController?.abort()
      uid = nextUID
      records = readStored(uid)
      historyCoverage = undefined
      notify()
    }
    return uid
  }
  const refreshStored = () => {
    if (disposed || !ensureAccount()) {
      return
    }
    for (const record of readStored(uid).values()) {
      records.set(record.bvid, mergeRecord(records.get(record.bvid), record))
    }
    notify()
  }
  const persist = () => {
    if (disposed || !ensureAccount()) {
      return
    }
    const latest = readStored(uid)
    for (const record of records.values()) {
      latest.set(record.bvid, mergeRecord(latest.get(record.bvid), record))
    }
    const bounded = [...latest.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, maximumRecords)
    records = new Map(bounded.map(record => [record.bvid, record]))
    GM_setValue(storagePrefix + uid, { version: 1, records: bounded } as SavedState)
    notify()
  }
  const put = (record: WatchProgress, expectedUID: string) => {
    if (disposed || !expectedUID || ensureAccount() !== expectedUID) {
      return
    }
    const completedParts: Record<string, number> = {}
    if (record.partCompleted && record.page && record.cid) {
      completedParts[String(record.page)] = record.cid
    }
    const normalized = sanitize({ ...record, completedParts })
    if (normalized) {
      records.set(record.bvid, mergeRecord(records.get(record.bvid), normalized))
      return true
    }
    return false
  }
  const visible = () => {
    if (document.visibilityState === 'visible') {
      refreshStored()
    }
  }
  window.addEventListener('focus', refreshStored)
  document.addEventListener('visibilitychange', visible)

  const syncHistory = async (
    signal?: AbortSignal,
    options: { extended?: boolean } = {},
  ): Promise<HistorySyncResult> => {
    const expectedUID = ensureAccount()
    if (!expectedUID) {
      throw new Error('请登录 B 站后同步观看记录。')
    }
    if (disposed || signal?.aborted) {
      throw abortError()
    }
    historyController?.abort()
    const controller = new AbortController()
    historyController = controller
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const params = new URLSearchParams({ type: 'archive', ps: String(historyPageSize) })
    const cursors = new Set<string>()
    const previousCoverage = historyCoverage
    const imported = new Set<string>()
    const extended = options.extended === true
    const pageLimit = extended ? extendedHistoryPageLimit : historyPageLimit
    const cutoff = Date.now() - historyWindow
    let newestAt = 0
    let oldestAt = Infinity
    let reusedCoverage = false
    const result: HistorySyncResult = {
      extended, fetchedPages: 0, importedRecords: 0,
      reachedEnd: false, reachedWindow: false, limited: false, retentionLimited: false,
    }
    try {
      for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
        if (disposed || ensureAccount() !== expectedUID || controller.signal.aborted) {
          throw abortError()
        }
        const data = await requestData<any>(
          `https://api.bilibili.com/x/web-interface/history/cursor?${params.toString()}`,
          controller.signal,
        )
        if (!Array.isArray(data.list)) {
          throw new Error('B 站返回的观看记录格式发生变化，请稍后重试。')
        }
        result.fetchedPages++
        for (const item of data.list.slice(0, historyPageSize)) {
          const history = item?.history
          if (history?.business !== 'archive' || !bvidPattern.test(history.bvid ?? '')) {
            continue
          }
          const rawProgress = Number(item.progress)
          const duration = Number(item.duration)
          const updatedAt = Number(item.view_at) * 1000
          if (!Number.isFinite(rawProgress) || rawProgress < -1 || !Number.isFinite(duration) || duration < 0 || !Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > Date.now() + 60000) {
            continue
          }
          newestAt = Math.max(newestAt, updatedAt)
          oldestAt = Math.min(oldestAt, updatedAt)
          const partCompleted = rawProgress === -1
          const accepted = put({
            bvid: history.bvid,
            cid: positiveInteger(history.cid) || undefined,
            page: positiveInteger(history.page) || undefined,
            pages: positiveInteger(item.videos) || undefined,
            position: partCompleted ? duration : Math.max(0, rawProgress),
            duration,
            completed: false,
            partCompleted,
            playbackEnded: rawProgress === -1,
            updatedAt,
            source: 'history',
          }, expectedUID)
          if (accepted) { imported.add(history.bvid) }
        }
        if (ensureAccount() !== expectedUID || controller.signal.aborted) {
          throw abortError()
        }
        persist()
        const cursor = data.cursor
        const viewAt = positiveInteger(cursor?.view_at)
        const max = positiveInteger(cursor?.max)
        const cursorKey = `${max}:${viewAt}`
        let nextCursor: HistoryCursor | undefined = viewAt
          ? { max, viewAt, business: typeof cursor.business === 'string' ? cursor.business : 'archive' }
          : undefined
        result.reachedEnd = !data.list.length || !nextCursor
        // Connect a fresh head to the previously imported continuous range before skipping it.
        // Without this overlap, jumping straight to an old cursor could miss newly watched videos.
        if (!result.reachedEnd && !reusedCoverage && previousCoverage && oldestAt <= previousCoverage.newestAt) {
          reusedCoverage = true
          if (oldestAt >= previousCoverage.oldestAt) {
            oldestAt = previousCoverage.oldestAt
            newestAt = Math.max(newestAt, previousCoverage.newestAt)
            nextCursor = previousCoverage.cursor
            result.reachedEnd = previousCoverage.reachedEnd
          }
        }
        const earliestRetained = records.size >= maximumRecords
          ? Math.min(...[...records.values()].map(record => record.updatedAt))
          : 0
        result.retentionLimited = earliestRetained > 0 && oldestAt < earliestRetained
        if (result.retentionLimited) {
          oldestAt = earliestRetained
          result.limited = true
        }
        if (newestAt && Number.isFinite(oldestAt)) {
          historyCoverage = { newestAt, oldestAt, cursor: nextCursor, reachedEnd: result.reachedEnd }
          result.oldestAt = oldestAt
        } else if (result.reachedEnd) {
          historyCoverage = undefined
        }
        result.importedRecords = imported.size
        result.reachedWindow = Number.isFinite(oldestAt) && oldestAt <= cutoff
        if (!nextCursor || result.reachedEnd || (extended && result.reachedWindow) || (!extended && reusedCoverage)) {
          break
        }
        if (result.retentionLimited || cursors.has(cursorKey)) {
          result.limited = true
          break
        }
        if (pageIndex === pageLimit - 1) { result.limited = true; break }
        cursors.add(cursorKey)
        params.set('view_at', String(nextCursor.viewAt))
        params.set('max', String(nextCursor.max))
        params.set('business', nextCursor.business)
      }
      return result
    } finally {
      signal?.removeEventListener('abort', abort)
      if (historyController === controller) {
        historyController = undefined
      }
    }
  }

  const startTracking = () => {
    if (disposed) {
      return () => {}
    }
    if (trackingCleanup) {
      return trackingCleanup
    }
    const lifetime = new AbortController()
    let detailsController: AbortController | undefined
    let media: HTMLVideoElement | undefined
    let context: PlaybackContext | undefined
    let targetKey = ''
    let armedKey = ''
    let initialBinding = true
    let lastSample: WatchProgress | undefined
    let sampleUID = ''
    let lastWrite = 0
    let bindingQueued = false
    const getTarget = (): PlaybackTarget | undefined => {
      if (location.hostname !== 'www.bilibili.com') {
        return undefined
      }
      const match = location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)(?:\/|$)/)
      if (!match) {
        return undefined
      }
      if (Array.isArray(unsafeWindow.cid)) {
        return undefined
      }
      const id = match[1]
      const page = positiveInteger(new URLSearchParams(location.search).get('p')) || 1
      const cid = positiveInteger(unsafeWindow.cid)
      return {
        key: `${id}:${page}:${cid}`,
        bvid: id.startsWith('BV') ? id : undefined,
        aid: id.startsWith('av') ? id.slice(2) : undefined,
        page,
        cid,
      }
    }
    const flush = () => {
      if (lastSample && ensureAccount() === sampleUID) {
        put(lastSample, sampleUID)
        persist()
        lastWrite = Date.now()
      }
    }
    const refreshContext = () => {
      const target = getTarget()
      const currentUID = ensureAccount()
      if ((target?.key === targetKey || (!target && !targetKey)) && sampleUID === currentUID) {
        return
      }
      // Flush the captured sample, never read a newly switched player's time into the old video.
      if (targetKey) {
        initialBinding = false
      }
      flush()
      lastSample = undefined
      context = undefined
      sampleUID = ensureAccount()
      targetKey = target?.key ?? ''
      armedKey = ''
      detailsController?.abort()
      if (!target || !sampleUID || lifetime.signal.aborted) {
        return
      }
      const controller = new AbortController()
      detailsController = controller
      const params = new URLSearchParams()
      params.set(target.bvid ? 'bvid' : 'aid', target.bvid ?? target.aid ?? '')
      requestData<any>(`https://api.bilibili.com/x/web-interface/view?${params}`, controller.signal)
        .then(data => {
          if (lifetime.signal.aborted || controller.signal.aborted || targetKey !== target.key || getTarget()?.key !== target.key) {
            return
          }
          const pages: any[] = Array.isArray(data.pages) ? data.pages : []
          const currentPage = target.cid
            ? pages.find(page => Number(page.cid) === target.cid)
            : pages.find(page => Number(page.page) === target.page)
          if (!bvidPattern.test(data.bvid ?? '') || !currentPage || !positiveInteger(currentPage.cid)) {
            return
          }
          context = {
            key: target.key,
            bvid: data.bvid,
            cid: Number(currentPage.cid),
            page: positiveInteger(currentPage.page) || target.page,
            pages: pages.length,
          }
          // An already-playing video may predate userscript initialization.
          if (initialBinding && media?.readyState >= 2 && !media.paused) {
            armedKey = target.key
          }
          initialBinding = false
        })
        .catch(error => {
          if (!controller.signal.aborted && !lifetime.signal.aborted) {
            console.warn('[Bilibili Clear] 无法读取本视频分 P 信息，暂不记录本地进度。', error)
          }
        })
    }
    const sample = (ended = false) => {
      refreshContext()
      if (!media || !context || context.key !== getTarget()?.key || armedKey !== context.key || ensureAccount() !== sampleUID) {
        return
      }
      const position = Number(media.currentTime)
      const duration = Number(media.duration)
      if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration <= 0 || (position === 0 && !lastSample && !ended)) {
        return
      }
      const partCompleted = ended || reachesCompletion(position, duration)
      const newlyCompleted = partCompleted && !lastSample?.partCompleted
      lastSample = {
        bvid: context.bvid,
        cid: context.cid,
        page: context.page,
        pages: context.pages,
        position: Math.min(position, duration),
        duration,
        completed: false,
        partCompleted,
        playbackEnded: ended || media.ended,
        updatedAt: Date.now(),
        source: 'local',
      }
      if (ended || newlyCompleted || Date.now() - lastWrite >= writeInterval) {
        flush()
      }
    }
    const ready = () => {
      refreshContext()
      armedKey = getTarget()?.key ?? ''
    }
    const timeUpdate = () => sample()
    const pause = () => { sample(); flush() }
    const ended = () => { sample(true); flush() }
    const resetMedia = () => {
      flush()
      armedKey = ''
      lastSample = undefined
    }
    const mediaEvents: [string, EventListener][] = [
      ['loadedmetadata', ready], ['playing', ready], ['timeupdate', timeUpdate],
      ['pause', pause], ['ended', ended], ['emptied', resetMedia], ['loadstart', resetMedia],
    ]
    const unbind = () => {
      mediaEvents.forEach(([name, handler]) => media?.removeEventListener(name, handler))
    }
    const bindMedia = () => {
      bindingQueued = false
      if (lifetime.signal.aborted) {
        return
      }
      refreshContext()
      const next = dq('.bpx-player-video-area video, .bpx-player-video-area bwp-video, .bilibili-player-video video, .bilibili-player-video bwp-video') as HTMLVideoElement | null
      if ((next ?? undefined) === media) {
        return
      }
      flush()
      unbind()
      media = next ?? undefined
      mediaEvents.forEach(([name, handler]) => media?.addEventListener(name, handler))
      if (media && !media.paused && media.readyState >= 2) {
        ready()
      }
    }
    const scheduleBinding = () => {
      if (!bindingQueued && !lifetime.signal.aborted) {
        bindingQueued = true
        Promise.resolve().then(bindMedia)
      }
    }
    const [observer] = childListSubtree(document.body, scheduleBinding)
    urlChange(scheduleBinding, { signal: lifetime.signal })
    videoChange(scheduleBinding, { signal: lifetime.signal })
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        sample()
        flush()
      }
    }
    window.addEventListener('pagehide', pause)
    document.addEventListener('visibilitychange', onVisibility)
    trackingCleanup = () => {
      flush()
      lifetime.abort()
      detailsController?.abort()
      observer.disconnect()
      unbind()
      window.removeEventListener('pagehide', pause)
      document.removeEventListener('visibilitychange', onVisibility)
      trackingCleanup = undefined
    }
    return trackingCleanup
  }

  return {
    get(bvid: string): WatchProgress | undefined {
      ensureAccount()
      const item = records.get(bvid)
      if (!item) {
        return undefined
      }
      const { completedParts, ...progress } = item
      return progress
    },
    subscribe(callback: () => void) {
      subscribers.add(callback)
      return () => { subscribers.delete(callback) }
    },
    syncHistory,
    startTracking,
    dispose() {
      if (disposed) {
        return
      }
      trackingCleanup?.()
      disposed = true
      historyController?.abort()
      window.removeEventListener('focus', refreshStored)
      document.removeEventListener('visibilitychange', visible)
      subscribers.clear()
    },
  }
}
