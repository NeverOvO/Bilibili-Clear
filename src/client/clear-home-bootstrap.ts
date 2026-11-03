import bootstrapStyle from './clear-home-bootstrap.scss'
import projectMark from '../ui/clear/project-mark.svg?inline'
import { recordHomeGuardFrame, recordHomeStartup } from './clear-home-diagnostics'

const bootstrapClass = 'clear-home-booting'
let style: HTMLStyleElement | undefined
let overlay: HTMLDivElement | undefined
let restoreButton: HTMLButtonElement | undefined
let timeout: number | undefined
let rootRetry: number | undefined
let generation = 0
let bypassed = false
let restoreButtonListener: (() => void) | undefined
let keydownListener: ((event: KeyboardEvent) => void) | undefined

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
  const missingModeLabel = mode === undefined ? '缺失' : '非预期值'
  const modeLabel = mode === '关注极简' || mode === '原版精简' ? mode : missingModeLabel
  recordHomeStartup(
    '早期模式读取结果',
    `内置配置=${builtIn ? '存在' : '缺失'}；旧扩展配置=${external ? '存在' : '缺失'}；` +
      `优先来源=${legacy ? '旧扩展' : '内置'}；开启=${enabled === true}；模式=${modeLabel}`,
  )
  return enabled === true && mode === '关注极简'
}

const readFollowingPreference = (): boolean => {
  // A staged import is the next startup's preference, before the core consumes it.
  const pending = GM_getValue('clearPendingSettingsImport', undefined)
  if (pending !== undefined) {
    recordHomeStartup('早期配置来源', '暂存导入；是否有效由后续核心设置加载判定')
    return wantsFollowingHome(pending)
  }
  recordHomeStartup('早期配置来源', '脚本管理器已保存的配置')
  return wantsFollowingHome({
    schemaVersion: GM_getValue('schemaVersion', undefined),
    components: GM_getValue('components', undefined),
    userComponents: GM_getValue('userComponents', undefined),
  })
}

/** Keep a late component mount from undoing a manual or timed-out return to the native home. */
export const isClearHomeBootstrapBypassed = () => bypassed

/** Remove the early guard after a successful handoff, a disabled component or a startup error. */
export const finishClearHomeBootstrap = (reason = '组件清理') => {
  if (overlay || timeout !== undefined || rootRetry !== undefined) {
    recordHomeStartup('预遮罩移除', reason)
  }
  generation++
  window.clearTimeout(timeout)
  window.clearTimeout(rootRetry)
  timeout = undefined
  rootRetry = undefined
  if (keydownListener) {
    window.removeEventListener('keydown', keydownListener)
    keydownListener = undefined
  }
  if (restoreButtonListener) {
    restoreButton?.removeEventListener('click', restoreButtonListener)
    restoreButtonListener = undefined
  }
  restoreButton = undefined
  overlay?.remove()
  overlay = undefined
  document.documentElement?.classList.remove(bootstrapClass)
  style?.remove()
  style = undefined
}

const restoreNativeHome = (reason: string) => {
  bypassed = true
  recordHomeStartup('本页恢复原版', reason)
  finishClearHomeBootstrap(reason)
  // An interrupted mount may already have applied this class without displaying its shell.
  document.documentElement?.classList.remove('clear-following-active')
}
/** Runs before Vue, lodash and settings initialization; never changes stored preferences. */
export const startClearHomeBootstrap = () => {
  finishClearHomeBootstrap('预遮罩重新启动')
  if (
    bypassed ||
    window.top !== window.self ||
    location.hostname !== 'www.bilibili.com' ||
    !/^\/(?:index\.html)?$/.test(location.pathname)
  ) {
    recordHomeStartup('跳过预遮罩', '不符合顶层首页范围，或本页已恢复原版')
    return
  }
  recordHomeStartup('预遮罩入口', `GM_getValue=${typeof GM_getValue}`)
  try {
    if (!readFollowingPreference()) {
      recordHomeStartup('跳过预遮罩', '早期配置未选择已启用的关注极简模式')
      return
    }
  } catch (error) {
    // An unavailable settings store must never leave the original homepage hidden.
    recordHomeStartup(
      '早期配置读取失败，跳过预遮罩',
      error instanceof Error ? error.name : typeof error,
    )
    return
  }
  const current = generation
  const attach = () => {
    if (current !== generation) {
      return
    }
    const root = document.documentElement
    if (!root) {
      if (rootRetry === undefined) {
        recordHomeStartup('预遮罩等待 html 元素')
      }
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
    restoreButtonListener = () => restoreNativeHome('点击返回原版')
    restoreButton.addEventListener('click', restoreButtonListener)
    content.append(mark, brand, status, restoreButton)
    overlay.appendChild(content)
    // Mount before <body> exists; the page parser must not delay the startup guard.
    root.appendChild(overlay)
    root.classList.add(bootstrapClass)
    recordHomeStartup('预遮罩已挂载', `body=${Boolean(document.body)}`)
    recordHomeGuardFrame(overlay)
    keydownListener = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        restoreNativeHome('按下 Escape')
      }
    }
    window.addEventListener('keydown', keydownListener)
    rootRetry = undefined
  }
  // Fail open even when the script manager or another extension interrupts startup.
  timeout = window.setTimeout(() => restoreNativeHome('等待超过 12 秒'), 12000)
  attach()
}
