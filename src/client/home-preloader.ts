import styleText from './clear-home-bootstrap.scss'
import markUrl from '../ui/clear/project-mark.svg?inline'
import {
  homePreloadKey,
  homePreloadLifetime,
  homePreloadState,
  homePreloadBypass,
  homePreloadReleaseEvent,
  homePreloadRestoreEvent,
  homePreloadTraceEvent,
  homePreloadTraceId,
  isTopHome,
  saveHomePreloadHint,
} from './home-preloader-protocol'

// Separate userscript entry: no GM storage, Vue, core imports or remote resources.
const start = () => {
  if (!isTopHome()) {
    return
  }
  const entered = performance.now()
  const entryState = document.readyState
  let hint = false
  try {
    const expires = Number(localStorage.getItem(homePreloadKey))
    const remaining = expires - Date.now()
    hint = Number.isFinite(expires) && remaining > 0 && remaining <= homePreloadLifetime
  } catch {
    // A blocked or absent mode hint leaves the native page visible.
  }
  let done = false
  let retry: number | undefined
  let deadline: number | undefined
  let frame: number | undefined
  let overlay: HTMLDivElement | undefined
  let style: HTMLStyleElement | undefined
  let trace: HTMLMetaElement | undefined
  const record = (phase: string, value: string) => {
    trace?.setAttribute(`data-${phase}`, value)
    document.dispatchEvent(new Event(homePreloadTraceEvent))
  }
  const finish = (reason: string, restore = false) => {
    if (done) {
      return
    }
    done = true
    window.clearTimeout(retry)
    window.clearTimeout(deadline)
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame)
    }
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener(homePreloadReleaseEvent, onRelease)
    document.removeEventListener(homePreloadRestoreEvent, onCoreRestore)
    overlay?.remove()
    style?.remove()
    document.documentElement?.classList.remove('clear-home-preloading')
    if (restore) {
      document.documentElement?.setAttribute(homePreloadBypass, 'true')
      saveHomePreloadHint(false)
    }
    record('reason', reason)
    record('release', String(performance.now()))
    if (restore) {
      document.dispatchEvent(new Event(homePreloadRestoreEvent))
    }
  }
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      finish('escape', true)
    }
  }
  function onRelease() {
    finish('core')
  }
  function onCoreRestore() {
    finish('restore')
  }
  function onPageHide() {
    finish('pagehide')
  }
  const attach = () => {
    if (done) {
      return
    }
    const root = document.documentElement
    if (!root) {
      retry = window.setTimeout(attach, 16)
      return
    }
    // An accidental second installation must not replace an existing guard or its trace.
    if (document.getElementById(homePreloadTraceId)) {
      done = true
      window.clearTimeout(deadline)
      return
    }
    trace = document.createElement('meta')
    trace.id = homePreloadTraceId
    trace.setAttribute('data-entry', String(entered))
    trace.setAttribute('data-state', entryState)
    trace.setAttribute('data-hint', String(hint))
    root.appendChild(trace)
    document.dispatchEvent(new Event(homePreloadTraceEvent))
    if (root.hasAttribute(homePreloadState) || root.hasAttribute(homePreloadBypass)) {
      finish('already-released')
      return
    }
    if (!hint) {
      finish('no-hint')
      return
    }
    try {
      style = document.createElement('style')
      style.textContent = styleText
      root.appendChild(style)
      overlay = document.createElement('div')
      overlay.id = 'bilibili-clear-home-preloader'
      const content = document.createElement('div')
      content.className = 'clear-home-transition-content'
      const mark = document.createElement('img')
      mark.src = markUrl
      mark.alt = ''
      mark.width = 56
      mark.height = 56
      const brand = document.createElement('strong')
      brand.textContent = 'Bilibili Clear'
      const status = document.createElement('p')
      status.setAttribute('role', 'status')
      status.textContent = '正在打开 UP 极简模式…'
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = '返回原版首页'
      button.addEventListener('click', () => finish('button', true))
      content.append(mark, brand, status, button)
      overlay.appendChild(content)
      root.appendChild(overlay)
      root.classList.add('clear-home-preloading')
      record('mount', String(performance.now()))
      document.addEventListener(homePreloadReleaseEvent, onRelease)
      document.addEventListener(homePreloadRestoreEvent, onCoreRestore)
      window.addEventListener('keydown', onKeydown)
      window.addEventListener('pagehide', onPageHide)
      frame = window.requestAnimationFrame(() => {
        record('frame', String(performance.now()))
      })
    } catch {
      finish('error', true)
    }
  }
  deadline = window.setTimeout(() => finish('timeout', true), 12000)
  attach()
}
start()
