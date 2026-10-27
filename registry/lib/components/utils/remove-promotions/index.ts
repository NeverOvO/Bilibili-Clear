import { RadioItem } from '@/ui'
import { ComponentEntry } from '@/components/types'
import { defineComponentMetadata } from '@/components/define'
import { createComponentWithProps } from '@/core/utils'
import {
  addComponentListener,
  getComponentSettings,
  removeComponentListener,
} from '@/core/settings'
import { childList } from '@/core/observer'
import { select, selectAll } from '@/core/spin-query'
import { startHomeAdblockCards, stopHomeAdblockCards } from './home-adblock'

const componentName = 'removePromotions'
const isHomePage = () =>
  /^https?:\/\/www\.bilibili\.com\/(?:index\.html)?(?:#.*)?$/.test(
    document.URL.replace(window.location.search, ''),
  )
const preloadAnchorSelector =
  '.bili-feed4 .recommended-container_floor-aside .container > .load-more-anchor'
const preloadClass = 'remove-promotions-preload-anchor'
let generation = 0
let cleanups: (() => void)[] = []
let retryPreload: () => void = none

const stop = () => {
  generation += 1
  stopHomeAdblockCards()
  retryPreload = none
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
}

const watchHomeFeedPreload = async (active: () => boolean, enabled: () => boolean) => {
  const anchor = await select<HTMLElement>(preloadAnchorSelector, { maxRetry: 60 })
  const container = anchor?.parentElement
  if (!anchor || !container || !active()) {
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let disposed = false
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    running = false
    anchor.classList.remove(preloadClass)
  }
  const preload = () => {
    if (disposed || running || !active() || !enabled() || !anchor.isConnected) {
      return
    }
    running = true
    anchor.classList.add(preloadClass)
    const initialCount = container.childElementCount
    let attempts = 0
    const tick = () => {
      if (
        disposed ||
        !active() ||
        !enabled() ||
        !anchor.isConnected ||
        container.childElementCount > initialCount ||
        attempts >= 16
      ) {
        cancel()
        return
      }
      attempts += 1
      window.dispatchEvent(new Event('scroll'))
      timer = setTimeout(tick, 1000)
    }
    tick()
  }
  let childCount = container.childElementCount
  const [observer] = childList(container, () => {
    const currentCount = container.childElementCount
    if (currentCount < childCount) {
      preload()
    }
    childCount = currentCount
  })
  cleanups.push(() => {
    disposed = true
    observer.disconnect()
    cancel()
  })
  retryPreload = () => {
    if (!enabled()) {
      cancel()
    } else {
      preload()
    }
  }
  preload()
}

const start = () => {
  stop()
  const currentGeneration = generation
  const settings = getComponentSettings(componentName)
  const active = () => currentGeneration === generation && settings.enabled
  const originalClasses = new Map<Element, Map<string, boolean>>()
  const rememberClass = (element: Element, name: string, value = true) => {
    if (!originalClasses.has(element)) {
      originalClasses.set(element, new Map())
    }
    const classes = originalClasses.get(element)
    if (!classes.has(name)) {
      classes.set(name, element.classList.contains(name))
    }
    element.classList.toggle(name, value)
  }
  cleanups.push(() => {
    originalClasses.forEach((classes, element) => {
      classes.forEach((value, name) => element.classList.toggle(name, value))
    })
  })
  ;[
    ['preserveEventBanner', 'preserve-event-banner'],
    ['preserveFeedGoods', 'preserve-feed-goods'],
    ['preserveReplyNotice', 'preserve-reply-notice'],
    ['hideContainer', 'remove-promotions-hide-container'],
    ['showPlaceholder', 'remove-promotions-show-placeholder'],
    ['debug', 'remove-promotions-debug'],
  ].forEach(([option, className]) => {
    const original = document.body.classList.contains(className)
    const listener = (value: boolean) => {
      if (!active()) {
        return
      }
      document.body.classList.toggle(className, Boolean(value))
      if (option === 'hideContainer') {
        retryPreload()
      }
    }
    addComponentListener(`${componentName}.${option}`, listener, true)
    cleanups.push(() => {
      removeComponentListener(`${componentName}.${option}`, listener)
      document.body.classList.toggle(className, original)
    })
  })
  if (!isHomePage()) {
    return
  }
  rememberClass(document.documentElement, 'bilibili-clear-home-promotions')
  startHomeAdblockCards().catch(error => console.warn('[删除广告] 首页识别失败', error))
  watchHomeFeedPreload(active, () => Boolean(settings.options.hideContainer)).catch(error => {
    console.warn('[删除广告] 推荐流预加载失败', error)
  })

  const addPlaceholder = (target: HTMLElement, modern = false) => {
    const placeholder = document.createElement('div')
    placeholder.className = modern ? 'blocked-ads new' : 'blocked-ads'
    placeholder.textContent = settings.options.showPlaceholder ? '🚫已屏蔽广告' : ''
    target.insertAdjacentElement('afterend', placeholder)
    cleanups.push(() => placeholder.remove())
  }
  select<HTMLElement>('.eva-extension-area').then(element => {
    if (active() && element?.parentElement) {
      rememberClass(element.parentElement, 'clear-promotion-spacing')
    }
  })
  selectAll<HTMLElement[]>('.gg-pic').then(pictures => {
    if (!active()) {
      return
    }
    pictures.forEach(element => {
      const link = element.parentElement
      if (!link?.parentElement?.parentElement) {
        return
      }
      rememberClass(link, 'clear-promotion-hidden')
      const index = [...link.parentElement.childNodes].indexOf(link) + 1
      const item = link.parentElement.parentElement.querySelector<HTMLElement>(
        `.pic li:nth-child(${index})`,
      )
      const itemLink = item?.querySelector<HTMLElement>('a:not(.more-text)')
      if (!item || !itemLink) {
        return
      }
      rememberClass(item, 'clear-promotion-slot')
      rememberClass(itemLink, 'clear-promotion-content')
      addPlaceholder(itemLink)
      item.querySelectorAll('a.more-text, img').forEach(it => {
        rememberClass(it, 'clear-promotion-hidden')
      })
    })
  })
  select('.focus-carousel.home-slide').then(slide => {
    if (!active() || !slide) {
      return
    }
    const cards = new Set(
      dqa(slide, '.gg-icon,.bypb-icon')
        .map(it => it.parentElement?.parentElement)
        .filter((it): it is HTMLElement => Boolean(it)),
    )
    cards.forEach(card => {
      rememberClass(card, 'clear-promotion-hidden')
      addPlaceholder(card, true)
    })
  })
}

const entry: ComponentEntry = () => start()

const items: Record<string, RadioItem> = {
  hide: {
    name: 'hideContainer',
    isOption: true,
  },
  custom: {
    name: 'custom',
    isOption: true,
    optionsIncluded: ['showPlaceholder'],
  },
  debug: {
    name: 'debug',
    isOption: true,
  },
}

const props = {
  title: '广告卡片选项',
  groupName: `${componentName}-promotions-card`,
  items,
  componentName,
  icon: 'mdi-checkbox-marked-circle-outline',
}

export const component = defineComponentMetadata({
  name: componentName,
  displayName: '删除广告',
  entry,
  reload: start,
  unload: stop,
  instantStyles: [
    {
      name: componentName,
      style: () => import('./remove-promotions.scss'),
    },
  ],
  tags: [componentsTags.utils],
  options: {
    preserveEventBanner: {
      displayName: '保留活动横幅',
      defaultValue: false,
    },
    preserveFeedGoods: {
      displayName: '保留动态商品推荐',
      defaultValue: false,
    },
    showWidget: {
      displayName: '显示小组件（刷新后生效）',
      defaultValue: false,
    },

    // 以下选项在 extraOptions 中显示，设置 hidden: true 以免重复渲染
    hideContainer: {
      displayName: '完全隐藏',
      defaultValue: true,
      hidden: true,
    },
    /** 无实际作用，仅用于记录选项组状态 */
    custom: {
      displayName: '自定义',
      defaultValue: false,
      hidden: true,
    },
    showPlaceholder: {
      displayName: '占位文本',
      defaultValue: true,
      hidden: true,
    },
    debug: {
      displayName: '调试模式',
      defaultValue: false,
      hidden: true,
    },
  },
  extraOptions: () =>
    import('@/ui').then(m =>
      createComponentWithProps(m.OptionRadioGroup, { ...props, isPopup: false }),
    ),
  widget: {
    component: () =>
      import('@/ui').then(m =>
        createComponentWithProps(m.OptionRadioGroup, { ...props, isPopup: true }),
      ),
    condition: async () => {
      return Boolean(getComponentSettings(componentName).options.showWidget)
    },
  },
})
