import { defineComponentMetadata } from '@/components/define'
import { contentLoaded } from '@/core/life-cycle'
import { childList, urlChange } from '@/core/observer'
import { getComponentSettings, isComponentEnabled } from '@/core/settings'
import { addStyle } from '@/core/style'
import { mountVueComponent } from '@/core/utils'
import {
  finishClearHomeBootstrap,
  isClearHomeBootstrapBypassed,
} from '@/client/clear-home-bootstrap'
import { getProgressStore, releaseProgressStore } from './runtime'
import { startNativeLotteryBridge } from './native-lottery'
import { markClearPageTitle } from './page-title'

let generation = 0
let routeController: AbortController | undefined
let view: ReturnType<typeof mountVueComponent> | undefined
let mounting: Promise<void> | undefined
const earlyStyles = new Map<string, HTMLStyleElement>()
const isHome = () =>
  location.hostname === 'www.bilibili.com' && /^\/(?:index\.html)?$/.test(location.pathname)

const removeView = () => {
  view?.$destroy()
  view?.$el.remove()
  view = undefined
  document.documentElement.classList.remove('clear-following-active', 'clear-shorts-active')
}
const disable = () => {
  generation++
  routeController?.abort()
  routeController = undefined
  mounting = undefined
  removeView()
  earlyStyles.forEach(style => style.remove())
  earlyStyles.clear()
  finishClearHomeBootstrap()
  releaseProgressStore()
}

/** The homepage can render as soon as <body> exists, without waiting for the native feed. */
const waitForBody = (signal: AbortSignal): Promise<HTMLElement | undefined> =>
  new Promise(resolve => {
    if (signal.aborted || document.body) {
      resolve(signal.aborted ? undefined : document.body)
      return
    }
    let observer: MutationObserver | undefined
    const finish = () => {
      observer?.disconnect()
      signal.removeEventListener('abort', finish)
      resolve(signal.aborted ? undefined : document.body || undefined)
    }
    signal.addEventListener('abort', finish, { once: true })
    ;[observer] = childList(document.documentElement, () => {
      if (document.body) {
        finish()
      }
    })
  })

// The normal style lifecycle still owns these SCSS files. Bridge only the early interval.
const prepareHomeStyles = async (current: number, signal: AbortSignal) => {
  const definitions = [
    { name: 'clear-home', load: () => import('./home.scss') },
    { name: 'clear-shorts', load: () => import('./shorts.scss') },
  ]
  await Promise.all(
    definitions.map(async ({ name, load }) => {
      if (document.getElementById(name) || earlyStyles.has(name)) {
        return
      }
      const { default: style } = await load()
      if (signal.aborted || current !== generation || document.getElementById(name)) {
        return
      }
      earlyStyles.set(name, addStyle(style, `${name}-early`))
    }),
  )
}
const releaseReplacedStyles = () => {
  for (const [name, style] of earlyStyles) {
    if (document.getElementById(name)) {
      style.remove()
      earlyStyles.delete(name)
    }
  }
}
const mountHome = (current: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted || current !== generation || !isHome() || view) {
    return Promise.resolve()
  }
  if (mounting) {
    return mounting
  }
  const task = (async () => {
    const body = await waitForBody(signal)
    if (!body || signal.aborted || current !== generation || !isHome()) {
      return
    }
    const [module] = await Promise.all([
      import('./ClearHome.vue'),
      prepareHomeStyles(current, signal),
    ])
    if (signal.aborted || current !== generation || !isHome() || view) {
      return
    }
    view = mountVueComponent(module)
    body.appendChild(view.$el)
    // Replacement styles, mode class and shell are all in place before the guard leaves.
    finishClearHomeBootstrap()
  })()
    .catch(error => {
      if (!signal.aborted && current === generation) {
        removeView()
        finishClearHomeBootstrap()
        console.error('[Bilibili Clear] 首页加载失败，已恢复原版。', error)
      }
    })
    .finally(() => {
      if (mounting === task) {
        mounting = undefined
      }
    })
  mounting = task
  return task
}
const enable = () => {
  releaseReplacedStyles()
  // Early startup and the normal component entry share one view and one route lifetime.
  if (routeController || window.top !== window.self) {
    return
  }
  const current = generation
  const controller = new AbortController()
  routeController = controller
  if (isHome()) {
    void mountHome(current, controller.signal)
  }
  contentLoaded(() => {
    if (controller.signal.aborted || current !== generation) {
      return
    }
    getProgressStore().startTracking()
    markClearPageTitle(controller.signal)
    startNativeLotteryBridge(controller.signal)
    urlChange(
      () => {
        if (controller.signal.aborted || current !== generation) {
          return
        }
        if (!isHome()) {
          removeView()
          finishClearHomeBootstrap()
          return
        }
        void mountHome(current, controller.signal)
      },
      { signal: controller.signal },
    )
  })
}

/** Only the selected replacement homepage opts out of the ordinary component loading delay. */
export const prepareClearHome = () => {
  if (
    window.top !== window.self ||
    !isHome() ||
    !isComponentEnabled('clearHome') ||
    getComponentSettings('clearHome').options.mode !== '关注极简' ||
    isClearHomeBootstrapBypassed()
  ) {
    finishClearHomeBootstrap()
    return
  }
  enable()
}
export const component = defineComponentMetadata({
  name: 'clearHome',
  displayName: '关注首页与竖屏模式',
  author: { name: 'NeverOvO', link: 'https://github.com/NeverOvO' },
  tags: [componentsTags.style, componentsTags.video],
  urlInclude: [/^https:\/\/www\.bilibili\.com\//],
  entry: enable,
  reload: enable,
  unload: disable,
  options: {
    mode: {
      displayName: '首页模式',
      defaultValue: '原版精简',
      dropdownEnum: { Original: '原版精简', Following: '关注极简' },
    },
  },
  instantStyles: [
    { name: 'clear-home', style: () => import('./home.scss') },
    { name: 'clear-shorts', style: () => import('./shorts.scss') },
  ],
})
