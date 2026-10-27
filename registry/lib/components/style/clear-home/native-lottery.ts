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
  const noop = () => undefined
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
  let removeLoadListener = noop
  const currentPost = () =>
    location.hostname === 'www.bilibili.com' &&
    /^\/opus\/([1-9]\d{0,24})\/?$/.exec(location.pathname)?.[1] === postId
  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    observer?.disconnect()
    clearTimeout(timeout)
    cancelAnimationFrame(frame)
    removeLoadListener()
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
    if (scheduled || document.readyState !== 'complete') {
      return
    }
    const entry = document.querySelector<HTMLElement>(entrySelector)
    if (!entry) {
      return
    }
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
  removeLoadListener = () => window.removeEventListener('load', findEntry)
  timeout = window.setTimeout(dispose, 15_000)
  const [entryObserver] = childListSubtree(document.body, findEntry)
  observer = entryObserver
  if (disposed) {
    observer.disconnect()
  }
  return dispose
}

/** The same official H5 URL used by Bilibili's own iframe popup. */
export const getNativeLotteryDetailUrl = (
  lottery: NonNullable<FollowingItem['lottery']>,
): string | undefined => {
  if (!validId(lottery.dynamicId) || !validId(lottery.id) || !lottery.nativeUrl) {
    return undefined
  }
  try {
    const url = new URL(lottery.nativeUrl)
    if (
      url.origin !== 'https://www.bilibili.com' ||
      url.pathname !== '/h5/lottery/result' ||
      url.searchParams.get('business_id') !== lottery.dynamicId ||
      !['1', '12'].includes(url.searchParams.get('business_type'))
    ) {
      return undefined
    }
    const result = new URL('https://www.bilibili.com/h5/lottery/result')
    result.searchParams.set('business_type', url.searchParams.get('business_type'))
    result.searchParams.set('business_id', lottery.dynamicId)
    result.searchParams.set('isWeb', '1')
    return result.href
  } catch {
    return undefined
  }
}

export interface NativeLotteryFrameOptions {
  onState: (state: { loaded: boolean; error: string }) => void
  onClose: () => void
  onFocusBoundary: (backwards: boolean) => void
}

/**
 * Render the official result/participation UI with its existing login session and controls.
 * Clear does not read the account state, listen to participation messages, or submit actions.
 */
export const mountNativeLotteryFrame = (
  iframe: HTMLIFrameElement,
  lottery: NonNullable<FollowingItem['lottery']>,
  options: NativeLotteryFrameOptions,
): (() => void) => {
  let disposed = false
  let failed = false
  let ready = false
  let contentObserver: MutationObserver | undefined
  let frameDocument: Document | undefined
  let timer = 0
  const target = getNativeLotteryDetailUrl(lottery)
  const onKeydown = (event: KeyboardEvent) => {
    if (disposed || event.defaultPrevented || event.isComposing) {
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      options.onClose()
      return
    }
    if (event.key !== 'Tab' || !frameDocument) {
      return
    }
    const focusable = [
      ...frameDocument.querySelectorAll<HTMLElement>(
        'a[href], button, input, textarea, select, iframe, [tabindex]',
      ),
    ].filter(
      element =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled, [aria-disabled="true"], [hidden]') &&
        element.getClientRects().length,
    )
    const active = frameDocument.activeElement
    const backwards = event.shiftKey
    if (
      !focusable.length ||
      (backwards && (active === focusable[0] || active === frameDocument.body)) ||
      (!backwards && active === focusable[focusable.length - 1])
    ) {
      event.preventDefault()
      options.onFocusBoundary(backwards)
    }
  }
  const detachDocument = () => {
    contentObserver?.disconnect()
    contentObserver = undefined
    frameDocument?.removeEventListener('keydown', onKeydown)
    frameDocument = undefined
  }
  const fail = (message: string) => {
    if (disposed || failed) {
      return
    }
    failed = true
    clearTimeout(timer)
    detachDocument()
    options.onState({ loaded: false, error: message })
    iframe.src = 'about:blank'
  }
  const hasVisibleContent = (element: HTMLElement | null) => {
    if (!element || !element.textContent?.trim() || !element.getClientRects().length) {
      return false
    }
    const style = frameDocument?.defaultView?.getComputedStyle(element)
    return style?.display !== 'none' && style?.visibility !== 'hidden'
  }
  const readNativeContent = () => {
    if (disposed || failed || ready || !frameDocument) {
      return
    }
    // Official H5 renders only .lottery-result > .loading until its result requests finish.
    // A body/load event therefore cannot distinguish an operational page from a blank SPA.
    const nativeError = frameDocument.querySelector<HTMLElement>('.error .error__text')
    if (hasVisibleContent(nativeError)) {
      fail('B 站暂时无法读取这次抽奖，可重试或打开原帖。')
      return
    }
    const result = frameDocument.querySelector<HTMLElement>(
      '.lottery-result--interactive, .lottery-result--upower',
    )
    if (!hasVisibleContent(result)) {
      return
    }
    ready = true
    clearTimeout(timer)
    contentObserver?.disconnect()
    contentObserver = undefined
    options.onState({ loaded: true, error: '' })
  }
  const onLoad = () => {
    if (disposed || failed || !target) {
      return
    }
    detachDocument()
    try {
      const win = iframe.contentWindow
      if (!win || win.location.href === 'about:blank') {
        return
      }
      const current = new URL(win.location.href)
      const expected = new URL(target)
      if (
        current.origin !== expected.origin ||
        current.pathname !== expected.pathname ||
        current.searchParams.get('business_id') !== lottery.dynamicId ||
        current.searchParams.get('business_type') !== expected.searchParams.get('business_type')
      ) {
        fail('抽奖页面已跳转，可打开原帖继续操作。')
        return
      }
      frameDocument = iframe.contentDocument || undefined
      if (!frameDocument?.body) {
        fail('抽奖详情暂时无法显示，可重试或打开原帖。')
        return
      }
      frameDocument.addEventListener('keydown', onKeydown)
      if (ready) {
        ready = false
        options.onState({ loaded: false, error: '' })
        timer = window.setTimeout(() => fail('抽奖详情加载较慢，可重试或打开原帖。'), 20_000)
      }
      const [observer] = childListSubtree(frameDocument.body, readNativeContent)
      contentObserver = observer
      if (disposed || failed || ready) {
        observer.disconnect()
        contentObserver = undefined
      }
    } catch {
      fail('无法加载 B 站抽奖详情，可打开原帖继续操作。')
    }
  }
  const onError = () => fail('抽奖详情加载失败，可重试或打开原帖。')
  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    clearTimeout(timer)
    iframe.removeEventListener('load', onLoad)
    iframe.removeEventListener('error', onError)
    detachDocument()
    // Stop the native document and release its listeners and requests when the modal closes.
    iframe.src = 'about:blank'
  }
  if (!target) {
    fail('这条动态未提供可内嵌的原生抽奖入口，请打开原帖。')
    return dispose
  }
  options.onState({ loaded: false, error: '' })
  iframe.addEventListener('load', onLoad)
  iframe.addEventListener('error', onError)
  timer = window.setTimeout(() => fail('抽奖详情加载较慢，可重试或打开原帖。'), 20_000)
  iframe.src = target
  return dispose
}
