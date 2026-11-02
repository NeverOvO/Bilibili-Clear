import bootstrapStyle from './clear-home-bootstrap.scss'
import projectMark from '../ui/clear/project-mark.svg?inline'

const bootstrapClass = 'clear-home-booting'
let style: HTMLStyleElement | undefined
let overlay: HTMLDivElement | undefined
let restoreButton: HTMLButtonElement | undefined
let timeout: number | undefined
let rootRetry: number | undefined
let generation = 0
let bypassed = false

type BootstrapComponentSettings = {
  enabled?: boolean
  options?: { mode?: string }
}
type BootstrapSettings = {
  schemaVersion?: number
  components?: { clearHome?: BootstrapComponentSettings }
  userComponents?: { clearHome?: { settings?: BootstrapComponentSettings } }
}

/** Match the mode precedence used when old external components become built-in features. */
const wantsFollowingHome = (settings: BootstrapSettings): boolean => {
  const builtIn = settings?.components?.clearHome
  const external = settings?.userComponents?.clearHome?.settings
  const legacy = (settings?.schemaVersion ?? 0) < 1
  const primary = legacy ? external : builtIn
  const fallback = legacy ? builtIn : external
  const enabled = primary?.enabled ?? fallback?.enabled ?? true
  const mode = primary?.options?.mode ?? fallback?.options?.mode
  return enabled === true && mode === '关注极简'
}

const readFollowingPreference = (): boolean => {
  // A staged import is the next startup's preference, before the core consumes it.
  const pending = GM_getValue('clearPendingSettingsImport', undefined)
  if (pending !== undefined) {
    return wantsFollowingHome(pending)
  }
  return wantsFollowingHome({
    schemaVersion: GM_getValue('schemaVersion', undefined),
    components: GM_getValue('components', undefined),
    userComponents: GM_getValue('userComponents', undefined),
  })
}

/** Keep a late component mount from undoing a manual or timed-out return to the native home. */
export const isClearHomeBootstrapBypassed = () => bypassed

/** Remove the early guard after a successful handoff, a disabled component or a startup error. */
export const finishClearHomeBootstrap = () => {
  generation++
  window.clearTimeout(timeout)
  window.clearTimeout(rootRetry)
  timeout = undefined
  rootRetry = undefined
  window.removeEventListener('keydown', onBootstrapKeydown)
  restoreButton?.removeEventListener('click', restoreNativeHome)
  restoreButton = undefined
  overlay?.remove()
  overlay = undefined
  document.documentElement?.classList.remove(bootstrapClass)
  style?.remove()
  style = undefined
}

const restoreNativeHome = () => {
  bypassed = true
  finishClearHomeBootstrap()
  // An interrupted mount may already have applied this class without displaying its shell.
  document.documentElement?.classList.remove('clear-following-active')
}

function onBootstrapKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    restoreNativeHome()
  }
}

/** Runs before Vue, lodash and settings initialization; never changes stored preferences. */
export const startClearHomeBootstrap = () => {
  finishClearHomeBootstrap()
  if (
    bypassed ||
    window.top !== window.self ||
    location.hostname !== 'www.bilibili.com' ||
    !/^\/(?:index\.html)?$/.test(location.pathname)
  ) {
    return
  }
  try {
    if (!readFollowingPreference()) {
      return
    }
  } catch {
    // An unavailable settings store must never leave the original homepage hidden.
    return
  }
  const current = generation
  const attach = () => {
    if (current !== generation) {
      return
    }
    const root = document.documentElement
    if (!root) {
      rootRetry = window.setTimeout(attach, 16)
      return
    }
    style = document.createElement('style')
    style.id = 'bilibili-clear-home-bootstrap'
    style.textContent = bootstrapStyle
    ;(document.head || root).appendChild(style)

    overlay = document.createElement('div')
    overlay.id = 'bilibili-clear-home-transition'
    const content = document.createElement('div')
    content.className = 'clear-home-transition-content'
    const mark = document.createElement('img')
    mark.src = projectMark
    mark.alt = ''
    mark.width = 56
    mark.height = 56
    const brand = document.createElement('strong')
    brand.textContent = 'Bilibili Clear'
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    status.textContent = '正在打开 UP 极简模式…'
    restoreButton = document.createElement('button')
    restoreButton.type = 'button'
    restoreButton.textContent = '返回原版首页'
    restoreButton.addEventListener('click', restoreNativeHome)
    content.append(mark, brand, status, restoreButton)
    overlay.appendChild(content)
    // Mount before <body> exists; the page parser must not delay the startup guard.
    root.appendChild(overlay)
    root.classList.add(bootstrapClass)
    window.addEventListener('keydown', onBootstrapKeydown)
    rootRetry = undefined
  }
  // Fail open even when the script manager or another extension interrupts startup.
  timeout = window.setTimeout(restoreNativeHome, 12000)
  attach()
}
