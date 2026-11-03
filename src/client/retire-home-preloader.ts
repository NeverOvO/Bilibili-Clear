/** Retire the optional Beta 6 helper without changing the user's homepage settings. */
export const retireHomePreloader = () => {
  if (window.top !== window.self || location.hostname !== 'www.bilibili.com') {
    return
  }
  try {
    localStorage.removeItem('bilibili-clear:following-home-until:v1')
  } catch {
    // Even when storage is blocked, release any cover already mounted by the old helper.
  }
  if (!/^\/(?:index\.html)?$/.test(location.pathname)) {
    return
  }
  const release = (attempt = 0) => {
    const root = document.documentElement
    if (!root) {
      if (attempt < 120) {
        window.setTimeout(() => release(attempt + 1), 16)
      }
      return
    }
    // This marker also prevents an installed helper from covering the page if it runs later.
    root.setAttribute('data-clear-home-core-state', 'released')
    document.dispatchEvent(new Event('bilibili-clear-home-release'))
    // The event lets the helper remove its private style and listeners. Remove known DOM
    // remnants as well in case that script was interrupted before registering its listener.
    root.classList.remove('clear-home-preloading')
    root.removeAttribute('data-clear-home-bypass')
    document.getElementById('bilibili-clear-home-preloader')?.remove()
    document.getElementById('bilibili-clear-home-preload-trace')?.remove()
  }
  release()
}
