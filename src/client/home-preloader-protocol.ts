// DOM signals only control a temporary cover. They never enable features or carry settings.
export const homePreloadKey = 'bilibili-clear:following-home-until:v1'
export const homePreloadLifetime = 24 * 60 * 60 * 1000
export const homePreloadState = 'data-clear-home-core-state'
export const homePreloadBypass = 'data-clear-home-bypass'
export const homePreloadReleaseEvent = 'bilibili-clear-home-release'
export const homePreloadRestoreEvent = 'bilibili-clear-home-restore'
export const homePreloadTraceEvent = 'bilibili-clear-home-preload-trace'
export const homePreloadTraceId = 'bilibili-clear-home-preload-trace'

export const isTopHome = () =>
  window.top === window.self &&
  location.hostname === 'www.bilibili.com' &&
  /^\/(?:index\.html)?$/.test(location.pathname)

export const saveHomePreloadHint = (following: boolean) => {
  if (window.top !== window.self || location.hostname !== 'www.bilibili.com') {
    return
  }
  try {
    if (following) {
      localStorage.setItem(homePreloadKey, String(Date.now() + homePreloadLifetime))
    } else {
      localStorage.removeItem(homePreloadKey)
    }
  } catch {
    // Storage is an optional hint; the GM settings remain authoritative.
  }
}

export const releaseHomePreloader = () => {
  if (!isTopHome()) {
    return
  }
  document.documentElement?.setAttribute(homePreloadState, 'released')
  document.dispatchEvent(new Event(homePreloadReleaseEvent))
}
