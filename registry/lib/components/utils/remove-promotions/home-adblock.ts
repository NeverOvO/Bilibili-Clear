import { mutationObserve } from '@/core/observer'
import { select } from '@/core/spin-query'

const markerClass = 'be-blocked-promotion'
const containerSelector = '.recommended-container_floor-aside'
const cardSelector = '.container :is(.feed-card, .bili-feed-card) .bili-video-card'
let container: Element | null = null
let observer: MutationObserver | undefined
let generation = 0
const pendingCards = new Set<HTMLElement>()
const markedCards = new Set<HTMLElement>()

const hasMessage = (element: Element, pseudo: string, message: string) => {
  const { content } = window.getComputedStyle(element, pseudo)
  return content === `"${message}"` || content === `'${message}'`
}

const scan = () => {
  const results = [...pendingCards]
    .filter(card => card.isConnected && container?.contains(card))
    .map(card => ({
      card,
      blocked:
        !card.querySelector('.bili-video-card__wrap, .bili-video-card__skeleton') &&
        Array.from(card.children).some(
          child =>
            hasMessage(child, '::before', '该内容被AdGuard/AdBlock类插件屏蔽') &&
            hasMessage(child, '::after', '请检查插件以恢复正常内容展示'),
        ),
    }))
  pendingCards.clear()
  // Batch style reads before class writes to avoid forcing a style recalculation per card.
  results.forEach(({ card, blocked }) => {
    card.classList.toggle(markerClass, blocked)
    if (blocked) {
      markedCards.add(card)
    } else {
      markedCards.delete(card)
    }
  })
  markedCards.forEach(card => {
    if (!card.isConnected || !container?.contains(card)) {
      card.classList.remove(markerClass)
      markedCards.delete(card)
    }
  })
}
const scheduleScan = lodash.debounce(scan, 100, { maxWait: 300 })

const enqueue = (node: Node, includeDescendants: boolean) => {
  if (!(node instanceof Element) || !container?.contains(node)) {
    return
  }
  const card = node.closest<HTMLElement>('.bili-video-card')
  if (card?.matches(cardSelector)) {
    pendingCards.add(card)
  }
  if (includeDescendants) {
    node.querySelectorAll<HTMLElement>(cardSelector).forEach(item => pendingCards.add(item))
  }
}

const withoutMarker = (classes: string) =>
  classes
    .split(/\s+/)
    .filter(name => name && name !== markerClass)
    .join(' ')

export const stopHomeAdblockCards = () => {
  generation += 1
  observer?.disconnect()
  observer = undefined
  scheduleScan.cancel()
  pendingCards.clear()
  markedCards.forEach(card => card.classList.remove(markerClass))
  markedCards.clear()
  container = null
}

export const startHomeAdblockCards = async () => {
  stopHomeAdblockCards()
  const currentGeneration = generation
  // The page shell appears before the feed. Observe that shell so a late or replaced feed
  // can attach without retaining an unbounded observer on the entire document.
  const root = await select('.bili-feed4', { maxRetry: 60, queryInterval: 1000 })
  if (currentGeneration !== generation) {
    return
  }
  if (!root) {
    console.warn('[删除广告] 未找到受支持的首页布局。')
    return
  }
  const updateContainer = () => {
    const target = root.querySelector(containerSelector)
    if (container === target) {
      return false
    }
    markedCards.forEach(card => card.classList.remove(markerClass))
    markedCards.clear()
    pendingCards.clear()
    container = target
    container?.querySelectorAll<HTMLElement>(cardSelector).forEach(card => pendingCards.add(card))
    return true
  }
  const [homeObserver] = mutationObserve(
    [root],
    {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    },
    records => {
      if (currentGeneration !== generation) {
        return
      }
      const changed = updateContainer()
      if (!changed) {
        records.forEach(record => {
          if (record.type === 'attributes') {
            const element = record.target as Element
            if (
              withoutMarker(record.oldValue ?? '') ===
              withoutMarker(element.getAttribute('class') ?? '')
            ) {
              return
            }
            enqueue(element, false)
          } else {
            enqueue(record.target, false)
            record.addedNodes.forEach(node => enqueue(node, true))
          }
        })
      }
      if (pendingCards.size > 0 || records.some(record => record.removedNodes.length > 0)) {
        scheduleScan()
      }
    },
  )
  observer = homeObserver
  scan()
}
