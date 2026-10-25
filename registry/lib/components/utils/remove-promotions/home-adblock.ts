import { childListSubtree } from '@/core/observer'
import { select } from '@/core/spin-query'

const markerClass = 'be-blocked-promotion'
let container: Element | null = null
let observer: MutationObserver | undefined
let generation = 0

const hasMessage = (element: Element, pseudo: string, message: string) => {
  const content = window.getComputedStyle(element, pseudo).content
  return content === `"${message}"` || content === `'${message}'`
}

const scan = () => {
  container
    ?.querySelectorAll<HTMLElement>('.container :is(.feed-card, .bili-feed-card) .bili-video-card')
    .forEach(card => {
      // 正常卡片和仍在加载的骨架不能当作广告. 站方占位符的 class 随页面变化,
      // 使用实际显示的两条伪元素文案识别, 不依赖随机 class 或卡片是否为空.
      const blocked =
        !card.querySelector('.bili-video-card__wrap, .bili-video-card__skeleton') &&
        Array.from(card.children).some(
          child =>
            hasMessage(child, '::before', '该内容被AdGuard/AdBlock类插件屏蔽') &&
            hasMessage(child, '::after', '请检查插件以恢复正常内容展示'),
        )
      card.classList.toggle(markerClass, blocked)
    })
}
const scheduleScan = lodash.debounce(scan, 100)

export const stopHomeAdblockCards = () => {
  generation += 1
  observer?.disconnect()
  observer = undefined
  scheduleScan.cancel()
  container?.querySelectorAll(`.${markerClass}`).forEach(card => {
    card.classList.remove(markerClass)
  })
  container = null
}

export const startHomeAdblockCards = async () => {
  stopHomeAdblockCards()
  const currentGeneration = generation
  const target = await select('.bili-feed4 .recommended-container_floor-aside')
  if (!target || currentGeneration !== generation) {
    return
  }
  container = target
  const [homeObserver] = childListSubtree(container, scheduleScan)
  observer = homeObserver
  scan()
}
