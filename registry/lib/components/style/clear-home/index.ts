import { defineComponentMetadata } from '@/components/define'
import { contentLoaded } from '@/core/life-cycle'
import { urlChange } from '@/core/observer'
import { mountVueComponent } from '@/core/utils'
import { finishClearHomeBootstrap } from '@/client/clear-home-bootstrap'
import { getProgressStore, releaseProgressStore } from './runtime'
import { startNativeLotteryBridge } from './native-lottery'

let generation = 0
let routeController: AbortController | undefined
let view: ReturnType<typeof mountVueComponent> | undefined
const isHome = () => location.hostname === 'www.bilibili.com' && /^\/(?:index\.html)?$/.test(location.pathname)
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
  removeView()
  releaseProgressStore()
}
const enable = () => {
  disable()
  if (window.top !== window.self) {
    return
  }
  const current = generation
  contentLoaded(async () => {
    if (current !== generation) {
      return
    }
    getProgressStore().startTracking()
    const controller = new AbortController()
    routeController = controller
    startNativeLotteryBridge(controller.signal)
    urlChange(async () => {
      if (current !== generation) {
        return
      }
      if (!isHome()) {
        removeView()
        finishClearHomeBootstrap()
        return
      }
      if (view) {
        return
      }
      const module = await import('./ClearHome.vue')
      if (current !== generation || !isHome() || view) {
        return
      }
      view = mountVueComponent(module)
      document.body.appendChild(view.$el)
      finishClearHomeBootstrap()
    }, { signal: controller.signal })
  })
}
export const component = defineComponentMetadata({
  name: 'clearHome',
  displayName: '关注首页与竖屏模式（Beta）',
  author: { name: 'NeverOvO', link: 'https://github.com/NeverOvO' },
  tags: [componentsTags.style, componentsTags.video],
  urlInclude: [/^https:\/\/www\.bilibili\.com\//],
  entry: enable,
  reload: enable,
  unload: () => {
    disable()
    finishClearHomeBootstrap()
  },
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
