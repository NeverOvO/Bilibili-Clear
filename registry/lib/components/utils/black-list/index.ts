import { defineComponentMetadata } from '@/components/define'
import { mutationObserve } from '@/core/observer'
import { select } from '@/core/spin-query'
import { addComponentListener, getComponentSettings, removeComponentListener } from '@/core/settings'
import { getData, registerData } from '@/plugins/data'
import { Toast } from '@/core/toast'
import { BlackListDataKey } from './common'

const name = 'blackList'
const hiddenClass = 'be-blacklist-hidden'
const cardSelector = '.recommended-container_floor-aside .bili-video-card, .feed2 .bili-video-card'
const authorSelector = '.bili-video-card__info--author'
type BlackListData = { up: string[]; upRegex: string[] }
let active = false
let observationGeneration = 0
let pendingRoot = false
let root: Element | null = null
let observer: MutationObserver | undefined
let exactNames = new Set<string>()
let expressions: RegExp[] = []
let invalidPatterns = new Set<unknown>()
const pendingCards = new Set<HTMLElement>()
const hiddenElements = new Set<HTMLElement>()

const getLists = () => {
  const [data] = getData(BlackListDataKey) as [BlackListData]
  return data
}
const hasRules = () => exactNames.size > 0 || expressions.length > 0

const scan = () => {
  if (!active || !hasRules() || !getComponentSettings(name).enabled) {
    pendingCards.clear()
    return
  }
  pendingCards.forEach(card => {
    if (!card.isConnected || !root?.contains(card)) {
      return
    }
    const author = card.querySelector(authorSelector)?.textContent?.trim() ?? ''
    const blocked = author !== '' && (exactNames.has(author) || expressions.some(rule => rule.test(author)))
    const container =
      card.closest<HTMLElement>('.feed-card') ??
      card.closest<HTMLElement>('.bili-feed-card') ??
      card
    container.classList.toggle(hiddenClass, blocked)
    if (blocked) {
      hiddenElements.add(container)
    } else {
      hiddenElements.delete(container)
    }
  })
  pendingCards.clear()
  hiddenElements.forEach(element => {
    if (!element.isConnected || !root?.contains(element)) {
      element.classList.remove(hiddenClass)
      hiddenElements.delete(element)
    }
  })
}
const scheduleScan = lodash.debounce(scan, 80, { maxWait: 250 })

const enqueue = (node: Node, descendants: boolean) => {
  const element = node instanceof Element ? node : node.parentElement
  if (!element || !root?.contains(element)) {
    return
  }
  const card = element.closest<HTMLElement>('.bili-video-card')
  if (card?.matches(cardSelector)) {
    pendingCards.add(card)
  }
  if (descendants) {
    element.querySelectorAll<HTMLElement>(cardSelector).forEach(it => pendingCards.add(it))
  }
}

const stopObservation = () => {
  observationGeneration += 1
  pendingRoot = false
  observer?.disconnect()
  observer = undefined
  scheduleScan.cancel()
  pendingCards.clear()
  hiddenElements.forEach(element => element.classList.remove(hiddenClass))
  hiddenElements.clear()
  root = null
}

const startObservation = async () => {
  if (observer || pendingRoot || !active || !hasRules()) {
    return
  }
  pendingRoot = true
  const currentGeneration = observationGeneration
  const target = await select('.bili-feed4, .feed2', { maxRetry: 60 })
  if (currentGeneration !== observationGeneration) {
    return
  }
  pendingRoot = false
  if (!target || !active || !hasRules() || !getComponentSettings(name).enabled) {
    return
  }
  root = target
  root.querySelectorAll<HTMLElement>(cardSelector).forEach(card => pendingCards.add(card))
  const [homeObserver] = mutationObserve(
    [root],
    { childList: true, subtree: true, characterData: true },
    records => {
      records.forEach(record => {
        enqueue(record.target, false)
        record.addedNodes.forEach(node => enqueue(node, true))
      })
      if (pendingCards.size > 0 || records.some(record => record.removedNodes.length > 0)) {
        scheduleScan()
      }
    },
  )
  observer = homeObserver
  scan()
}

const updateRules = () => {
  if (!active) {
    return
  }
  const data = getLists()
  exactNames = new Set(
    data.up.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean),
  )
  const nextInvalid = new Set<unknown>()
  const invalidIndexes: number[] = []
  expressions = data.upRegex.flatMap((pattern, index) => {
    if (typeof pattern === 'string' && pattern.trim() === '') {
      return []
    }
    try {
      if (typeof pattern !== 'string') {
        throw new Error('正则表达式必须是文本')
      }
      return [new RegExp(pattern)]
    } catch {
      nextInvalid.add(pattern)
      if (!invalidPatterns.has(pattern)) {
        invalidIndexes.push(index + 1)
      }
      return []
    }
  })
  invalidPatterns = nextInvalid
  if (invalidIndexes.length > 0) {
    Toast.info(
      `第 ${invalidIndexes.join('、')} 条正则表达式无法解析，已忽略。其他黑名单规则继续生效。`,
      '黑名单设置',
      5000,
    )
  }
  if (!hasRules()) {
    stopObservation()
    return
  }
  if (root) {
    root.querySelectorAll<HTMLElement>(cardSelector).forEach(card => pendingCards.add(card))
    scheduleScan()
  } else {
    startObservation().catch(error => console.warn('[黑名单] 首页过滤加载失败', error))
  }
}
const scheduleRules = lodash.debounce(updateRules, 0)

const unload = () => {
  active = false
  removeComponentListener(`${name}.up`, scheduleRules)
  removeComponentListener(`${name}.upRegex`, scheduleRules)
  scheduleRules.cancel()
  stopObservation()
}

const start = () => {
  unload()
  active = true
  // Keep the original shared data key and the settings dialog's addData/save contract.
  // Accessors keep UI/provider changes on the same persistent option arrays.
  registerData(BlackListDataKey, {
    get up() {
      return getComponentSettings(name).options.up
    },
    set up(value: string[]) {
      getComponentSettings(name).options.up = value
    },
    get upRegex() {
      return getComponentSettings(name).options.upRegex
    },
    set upRegex(value: string[]) {
      getComponentSettings(name).options.upRegex = value
    },
  })
  getLists()
  addComponentListener(`${name}.up`, scheduleRules)
  addComponentListener(`${name}.upRegex`, scheduleRules)
  updateRules()
}

export const component = defineComponentMetadata({
  name,
  entry: start,
  reload: start,
  unload,
  instantStyles: [{ name, style: () => import('./black-list.scss') }],
  extraOptions: () => import('./Settings.vue').then(m => m.default),
  options: {
    up: {
      displayName: 'up主名称',
      defaultValue: [],
      hidden: true,
    },
    upRegex: {
      displayName: '正则匹配up主名称',
      defaultValue: [],
      hidden: true,
    },
  },
  displayName: '屏蔽黑名单up主',
  tags: [componentsTags.utils],
  author: {
    name: 'snowraincloud',
    link: 'https://github.com/snowraincloud',
  },
  urlInclude: [/^https?:\/\/www\.bilibili\.com\/(?:index\.html)?(?:[?#].*)?$/],
})
