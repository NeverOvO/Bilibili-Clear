import bootstrapStyle from './clear-home-bootstrap.scss'

const bootstrapClass = 'clear-home-booting'
let style: HTMLStyleElement | undefined
let timeout: number | undefined
let rootRetry: number | undefined
let generation = 0

/** Remove the early native-home guard when the replacement is mounted, disabled or fails. */
export const finishClearHomeBootstrap = () => {
  generation++
  window.clearTimeout(timeout)
  window.clearTimeout(rootRetry)
  timeout = undefined
  rootRetry = undefined
  document.documentElement?.classList.remove(bootstrapClass)
  style?.remove()
  style = undefined
}

/** Runs before Vue, lodash and core settings initialization; never changes stored preferences. */
export const startClearHomeBootstrap = () => {
  finishClearHomeBootstrap()
  if (
    window.top !== window.self ||
    location.hostname !== 'www.bilibili.com' ||
    !/^\/(?:index\.html)?$/.test(location.pathname)
  ) {
    return
  }
  try {
    const components = GM_getValue('components', undefined)
    const clearHome = components?.clearHome
    if (
      !clearHome ||
      (clearHome.enabled !== undefined && clearHome.enabled !== true) ||
      clearHome.options?.mode !== '关注极简'
    ) {
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
      rootRetry = window.setTimeout(attach, 0)
      return
    }
    style = document.createElement('style')
    style.id = 'bilibili-clear-home-bootstrap'
    style.textContent = bootstrapStyle
    ;(document.head || root).appendChild(style)
    root.classList.add(bootstrapClass)
    rootRetry = undefined
  }
  // Fail open even when a browser or an extension prevents the normal startup from finishing.
  timeout = window.setTimeout(finishClearHomeBootstrap, 9000)
  attach()
}
