import { childListSubtree } from '@/core/observer'
import type { FollowingItem } from './following'

const marker = 'bilibili_clear_lottery'
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,24}$/.test(value)

/** Open Bilibili's original post; the marker requests only its native lottery details dialog. */
export const getNativeLotteryUrl = (lottery: NonNullable<FollowingItem['lottery']>): string => {
  if (!validId(lottery.dynamicId) || !validId(lottery.id)) {
    return 'https://t.bilibili.com/'
  }
  const url = new URL(`https://www.bilibili.com/opus/${lottery.dynamicId}`)
  url.searchParams.set(marker, lottery.id)
  return url.href
}

/**
 * The site's current Opus rich node has data-type="lottery" and data-rid; its delegated click
 * opens the native “抽奖详情” dialog. Never click participation, repost, follow or pay buttons.
 * Unsupported layouts remain on the original post so the user can continue there themselves.
 */
export const startNativeLotteryBridge = (signal: AbortSignal): (() => void) => {
  const noop = () => {}
  if (signal.aborted || window.top !== window.self || location.hostname !== 'www.bilibili.com') {
    return noop
  }
  const url = new URL(location.href)
  const postId = /^\/opus\/([1-9]\d{0,24})\/?$/.exec(url.pathname)?.[1]
  const lotteryId = url.searchParams.get(marker)
  if (!postId || !validId(lotteryId)) {
    return noop
  }
  // Consume the request before installing observers, so refreshing the post never opens it twice.
  url.searchParams.delete(marker)
  history.replaceState(history.state, '', url.href)
  let disposed = false
  let scheduled = false
  let observer: MutationObserver | undefined
  let timeout = 0
  let frame = 0
  const currentPost = () =>
    location.hostname === 'www.bilibili.com' &&
    /^\/opus\/([1-9]\d{0,24})\/?$/.exec(location.pathname)?.[1] === postId
  const dispose = () => {
    if (disposed) { return }
    disposed = true
    observer?.disconnect()
    clearTimeout(timeout)
    cancelAnimationFrame(frame)
    window.removeEventListener('load', findEntry)
    window.removeEventListener('pagehide', dispose)
    signal.removeEventListener('abort', dispose)
  }
  const entrySelector = `.bili-opus-view .opus-text-rich-hl.lottery[data-type="lottery"][data-rid="${lotteryId}"]`
  function findEntry() {
    if (disposed || signal.aborted || !currentPost()) {
      dispose()
      return
    }
    // Server-rendered text can exist before Vue attaches its delegated click handler.
    if (scheduled || document.readyState !== 'complete') { return }
    const entry = document.querySelector<HTMLElement>(entrySelector)
    if (!entry) { return }
    scheduled = true
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (disposed || signal.aborted || !currentPost()) {
          dispose()
          return
        }
        if (!entry.isConnected) {
          scheduled = false
          findEntry()
          return
        }
        dispose()
        entry.click()
      })
    })
  }
  signal.addEventListener('abort', dispose, { once: true })
  window.addEventListener('pagehide', dispose, { once: true })
  window.addEventListener('load', findEntry, { once: true })
  timeout = window.setTimeout(dispose, 15_000)
  const [entryObserver] = childListSubtree(document.body, findEntry)
  observer = entryObserver
  if (disposed) { observer.disconnect() }
  return dispose
}
