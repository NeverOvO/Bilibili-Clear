import { ComponentEntry } from '@/components/types'
import { isIframe, isNotHtml, matchUrlPattern, mountVueComponent } from '@/core/utils'
import { setupNotifyStyle } from './notify-style'
import { setupLinkPopupContentAlignStyle } from './link-popup-content-align-style'
import { migrateOrders } from './orders-migration'
import {
  addNavbarListener,
  getNavbarSession,
  isNavbarActive,
  isNavbarSessionActive,
  pauseNavbarListeners,
  resumeNavbarListeners,
} from './lifecycle'
import { checkTransparentFill, stopTransparentFill } from './transparent-fill'
import { closeNavbarSettings } from './settings/vm'

type Navbar = Vue & {
  styles: string[]
  toggleStyle: (value: boolean, style: string) => void
}
let customNavbar: Navbar | undefined
let initialized = false
let restorePage: (() => void) | undefined
const activeClass = 'bilibili-clear-navbar-active'

const rememberPageState = () => {
  const root = document.documentElement
  const properties = ['--navbar-height', '--navbar-bounds-padding', '--navbar-search-width']
  const styles = properties.map(name => ({
    name,
    value: root.style.getPropertyValue(name),
    priority: root.style.getPropertyPriority(name),
  }))
  const attributes = ['data-navbar-notify-style', 'data-navbar-link-popup-content-align-style'].map(
    name => ({ name, value: root.getAttribute(name) }),
  )
  const classes = ['fixed-navbar', 'history-page', 'season-logo-enabled'].map(name => ({
    name,
    enabled: document.body.classList.contains(name),
  }))
  return () => {
    styles.forEach(({ name, value, priority }) => {
      if (value) {
        root.style.setProperty(name, value, priority)
      } else {
        root.style.removeProperty(name)
      }
    })
    attributes.forEach(({ name, value }) => {
      if (value === null) {
        root.removeAttribute(name)
      } else {
        root.setAttribute(name, value)
      }
    })
    classes.forEach(({ name, enabled }) => document.body.classList.toggle(name, enabled))
  }
}

export const unload = () => {
  pauseNavbarListeners()
  stopTransparentFill()
  document.documentElement.classList.remove(activeClass)
  closeNavbarSettings()
  document.querySelectorAll('.custom-navbar .peek').forEach(it => it.classList.remove('peek'))
  restorePage?.()
  restorePage = undefined
}

const initializeListeners = () => {
  ;[
    ['padding', '--navbar-bounds-padding', '%'],
    ['searchBarWidth', '--navbar-search-width', 'vw'],
    ['height', '--navbar-height', 'px'],
  ].forEach(([option, property, unit]) => {
    addNavbarListener(
      `customNavbar.${option}`,
      value => document.documentElement.style.setProperty(property, `${value}${unit}`),
      true,
    )
  })
  const globalFixedExclude = [
    'https://space.bilibili.com',
    'https://www.bilibili.com/read',
    'https://www.bilibili.com/opus',
    'https://www.bilibili.com/account/history',
    'https://www.bilibili.com/history',
    'https://www.bilibili.com/v/topic/detail',
    'https://www.bilibili.com/watchlater/list',
  ]
  if (!globalFixedExclude.some(p => matchUrlPattern(p))) {
    addNavbarListener(
      'customNavbar.globalFixed',
      value => document.body.classList.toggle('fixed-navbar', value),
      true,
    )
  }
  ;['fill', 'shadow', 'blur'].forEach(style => {
    addNavbarListener(`customNavbar.${style}`, value => customNavbar.toggleStyle(value, style), true)
  })
  setupNotifyStyle()
  setupLinkPopupContentAlignStyle()
}

export const reload = async () => {
  if (isIframe() || isNotHtml() || isNavbarActive()) {
    return
  }
  migrateOrders()
  restorePage = rememberPageState()
  document.documentElement.classList.add(activeClass)
  resumeNavbarListeners()
  const session = getNavbarSession()
  try {
    if (!customNavbar) {
      const CustomNavbar = await import('./CustomNavbar.vue')
      if (!isNavbarSessionActive(session)) {
        if (session === getNavbarSession()) {
          unload()
        }
        return
      }
      customNavbar = mountVueComponent<Navbar>(CustomNavbar)
      document.body.insertAdjacentElement('beforeend', customNavbar.$el)
    }
    if (!initialized) {
      initializeListeners()
      initialized = true
    }
    if (matchUrlPattern('https://www.bilibili.com/account/history')) {
      document.body.classList.add('history-page')
    }
    checkTransparentFill(customNavbar).catch(error => {
      console.warn('[自定义顶栏] 透明填充加载失败', error)
    })
  } catch (error) {
    if (session === getNavbarSession()) {
      unload()
    }
    throw error
  }
}

export const entry: ComponentEntry = () => reload()
