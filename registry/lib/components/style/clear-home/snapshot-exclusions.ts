import { childList, mutationObserve } from '@/core/observer'

// Keep this list aligned with the native roots hidden by home.scss. display:none
// does not stop html2canvas's synchronous DOM cloning and computed-style copying.
const nativeRoots = [
  '#i_cecream',
  '#app',
  '.international-home',
  '.international-header',
  '.international-footer',
  '.bili-header-m',
  '.bili-feed4',
  '.bili-footer',
  '.custom-navbar',
  '.custom-navbar-settings',
].join(',')
const ignoreAttribute = 'data-html2canvas-ignore'
const ownedMarker = 'bilibili-clear-hidden-home'

/** Exclude only the native DOM that the replacement homepage currently hides. */
export const startHomeSnapshotExclusions = () => {
  const owned = new Set<Element>()
  let active = false
  let bodyObserver: MutationObserver | undefined
  let rootsChanged = false
  const release = (element: Element) => {
    // Preserve attributes that already existed or were subsequently changed by others.
    if (element.getAttribute(ignoreAttribute) === ownedMarker) {
      element.removeAttribute(ignoreAttribute)
    }
    rootsChanged = owned.delete(element) || rootsChanged
  }
  const mark = (element: Element) => {
    if (
      element.hasAttribute(ignoreAttribute) ||
      element.closest('.clear-home-root') ||
      element.querySelector('.clear-home-root')
    ) {
      return
    }
    element.setAttribute(ignoreAttribute, ownedMarker)
    owned.add(element)
    rootsChanged = true
  }
  const scan = (root: Element) => {
    if (root.closest('.clear-home-root')) {
      return
    }
    if (root.matches(nativeRoots)) {
      mark(root)
    }
    root.querySelectorAll(nativeRoots).forEach(mark)
  }
  const observeRoots = () => {
    if (!bodyObserver) {
      return
    }
    bodyObserver.disconnect()
    bodyObserver.observe(document.body, { childList: true })
    owned.forEach(element => {
      bodyObserver.observe(element, { attributes: true, attributeFilter: ['id', 'class'] })
    })
    rootsChanged = false
  }
  const sync = () => {
    const classes = document.documentElement.classList
    const next = classes.contains('clear-following-active') || classes.contains('clear-shorts-active')
    if (next === active) {
      return
    }
    active = next
    if (!active) {
      bodyObserver?.disconnect()
      bodyObserver = undefined
      owned.forEach(release)
      return
    }
    scan(document.body)
    // Native roots mount beside the replacement. Watch direct body children and
    // the marked roots' identity, not feed mutations or hover classes throughout the page.
    ;[bodyObserver] = childList(document.body, records => {
      owned.forEach(element => {
        if (!element.isConnected || !element.matches(nativeRoots)) {
          release(element)
        }
      })
      records.forEach(record => {
        record.addedNodes.forEach(node => {
          if (node instanceof Element && node.isConnected) {
            scan(node)
          }
        })
      })
      if (rootsChanged) {
        observeRoots()
      }
    })
    observeRoots()
  }
  // Read actual mode classes so startup fallback and external mode changes also restore marks.
  const [modeObserver] = mutationObserve(
    [document.documentElement],
    { attributes: true, attributeFilter: ['class'] },
    sync,
  )
  return () => {
    modeObserver.disconnect()
    bodyObserver?.disconnect()
    owned.forEach(release)
  }
}
