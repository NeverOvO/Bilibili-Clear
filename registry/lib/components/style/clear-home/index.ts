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
import { finishHomeStartupDiagnostics, recordHomeStartup } from '@/client/clear-home-diagnostics'
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
  recordHomeStartup('首页组件卸载')
  finishClearHomeBootstrap('首页组件卸载')
  finishHomeStartupDiagnostics()
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
    recordHomeStartup('首页挂载等待 body')
    const body = await waitForBody(signal)
    if (!body || signal.aborted || current !== generation || !isHome()) {
      recordHomeStartup('首页挂载取消', 'body 未就绪、组件已卸载或已离开首页')
      return
    }
    recordHomeStartup('首页 body 已就绪；界面与样式加载开始')
    const [module] = await Promise.all([
      import('./ClearHome.vue'),
      prepareHomeStyles(current, signal),
    ])
    if (signal.aborted || current !== generation || !isHome() || view) {
      recordHomeStartup('首页挂载取消', '组件状态或页面已变化，或已有实例')
      return
    }
    recordHomeStartup('首页界面与样式加载完成')
    view = mountVueComponent(module)
    body.appendChild(view.$el)
    recordHomeStartup(
      '首页视图已挂载',
      `节点已连接=${view.$el.isConnected}；极简标记=${document.documentElement.classList.contains(
        'clear-following-active',
      )}`,
    )
    // Replacement styles, mode class and shell are all in place before the guard leaves.
    finishClearHomeBootstrap('首页视图接管')
    finishHomeStartupDiagnostics()
  })()
    .catch(error => {
      if (!signal.aborted && current === generation) {
        recordHomeStartup('首页加载失败', error instanceof Error ? error.name : typeof error)
        removeView()
        finishClearHomeBootstrap('首页加载失败')
        finishHomeStartupDiagnostics()
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
    recordHomeStartup('复用首页组件', '已有启动流程，或当前为子框架')
    return
  }
  recordHomeStartup('首页组件启动')
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
          recordHomeStartup('已离开首页')
          finishClearHomeBootstrap('离开首页')
          finishHomeStartupDiagnostics()
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
  if (window.top !== window.self || !isHome()) {
    finishClearHomeBootstrap('不在顶层首页')
    return
  }
  const enabled = isComponentEnabled('clearHome')
  const mode = getComponentSettings('clearHome').options.mode
  const bypassed = isClearHomeBootstrapBypassed()
  const modeLabel = mode === '关注极简' || mode === '原版精简' ? mode : '缺失或非预期值'
  recordHomeStartup(
    '核心确认首页模式',
    `开启=${enabled}；模式=${modeLabel}；本页恢复原版=${bypassed}`,
  )
  if (!enabled || mode !== '关注极简' || bypassed) {
    recordHomeStartup('未提前挂载极简首页', '组件关闭、模式未选择极简或本页已恢复原版')
    finishClearHomeBootstrap('核心确认无需极简预遮罩')
    finishHomeStartupDiagnostics()
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
