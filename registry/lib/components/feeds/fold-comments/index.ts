import { defineComponentMetadata } from '@/components/define'
import { feedsUrlsWithoutDetail } from '@/core/utils/urls'
import { FeedsCard, FeedsCardsManagerEventType, feedsCardsManager } from '@/components/feeds/api'
import { childListSubtree } from '@/core/observer'
import { getComponentSettings } from '@/core/settings'
import type { ShadowRootStyleEntry } from '@/core/shadow-root'

const commentSelector = '.bb-comment, .bili-comment-container'
const attachedCards = new Map<
  HTMLElement,
  { observer: MutationObserver; buttons: Set<HTMLElement> }
>()
let generation = 0
let active = false
let shadowStyle: ShadowRootStyleEntry | undefined

const removeCard = (card: HTMLElement) => {
  const attached = attachedCards.get(card)
  if (!attached) {
    return
  }
  attached.observer.disconnect()
  attached.buttons.forEach(button => button.remove())
  attachedCards.delete(card)
}

const attachCard = (card: HTMLElement) => {
  if (!active || attachedCards.has(card) || !getComponentSettings('foldComments').enabled) {
    return
  }
  const buttons = new Set<HTMLElement>()
  const injectButton = () => {
    if (!active || !card.isConnected || !getComponentSettings('foldComments').enabled) {
      return
    }
    // The panel can be absent, still loading, or replaced after each open/close.
    const commentBox = card.querySelector<HTMLElement>(commentSelector)
    if (!commentBox || commentBox.querySelector('.fold-comment')) {
      return
    }
    buttons.forEach(button => {
      if (!button.isConnected) {
        buttons.delete(button)
      }
    })
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'fold-comment'
    button.textContent = '收起评论'
    button.addEventListener('click', () => {
      if (!active || !getComponentSettings('foldComments').enabled) {
        return
      }
      const originalButton =
        feedsCardsManager.managerType === 'v2'
          ? card.querySelector<HTMLElement>('.bili-dyn-action.comment')
          : card.querySelector<HTMLElement>('.button-bar > :nth-child(2)')
      if (!originalButton) {
        return
      }
      originalButton.click()
      card.scrollIntoView()
      window.scrollBy({ top: -75 })
    })
    buttons.add(button)
    commentBox.appendChild(button)
  }
  const [observer] = childListSubtree(card, injectButton)
  attachedCards.set(card, { observer, buttons })
}
const onAdded = (event: CustomEvent<FeedsCard>) => attachCard(event.detail.element)
const onRemoved = (event: CustomEvent<FeedsCard>) => removeCard(event.detail.element)

const unload = () => {
  active = false
  generation += 1
  feedsCardsManager.removeEventListener(FeedsCardsManagerEventType.AddCard, onAdded)
  feedsCardsManager.removeEventListener(FeedsCardsManagerEventType.RemoveCard, onRemoved)
  attachedCards.forEach((_, card) => removeCard(card))
  shadowStyle?.remove()
  shadowStyle = undefined
}

const start = async () => {
  unload()
  active = true
  const currentGeneration = generation
  const isCurrent = () =>
    active && currentGeneration === generation && getComponentSettings('foldComments').enabled
  const stopIfCurrent = () => {
    if (currentGeneration === generation) {
      unload()
    }
  }
  feedsCardsManager.addEventListener(FeedsCardsManagerEventType.AddCard, onAdded)
  feedsCardsManager.addEventListener(FeedsCardsManagerEventType.RemoveCard, onRemoved)
  try {
    const started = await feedsCardsManager.startWatching()
    if (!isCurrent() || !started) {
      stopIfCurrent()
      return
    }
    feedsCardsManager.cards.forEach(card => attachCard(card.element))
    const [{ shadowRootStyles }, { default: style }] = await Promise.all([
      import('@/core/shadow-root'),
      import('./fold-comment-shadow.scss'),
    ])
    if (!isCurrent()) {
      stopIfCurrent()
      return
    }
    const entry = await shadowRootStyles.addStyle({ id: 'foldComments', style })
    if (!isCurrent()) {
      entry.remove()
      stopIfCurrent()
      return
    }
    shadowStyle = entry
  } catch (error) {
    stopIfCurrent()
    throw error
  }
}

export const component = defineComponentMetadata({
  name: 'foldComments',
  displayName: '快速收起评论',
  urlInclude: feedsUrlsWithoutDetail,
  tags: [componentsTags.feeds],
  entry: start,
  reload: start,
  unload,
  instantStyles: [{ name: 'foldComments', style: () => import('./fold-comment.scss') }],
})
