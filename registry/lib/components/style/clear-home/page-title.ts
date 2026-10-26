import { mutationObserve } from '@/core/observer'
import { appendClearPageTitle, restoreOriginalPageTitle } from '@/core/page-title'

/** Follow native SPA title updates without accumulating suffixes or changing iframe titles. */
export const markClearPageTitle = (signal: AbortSignal) => {
  if (signal.aborted || window.top !== window.self || !document.head) { return }
  const [observer] = mutationObserve([document.head], {
    childList: true, subtree: true, characterData: true,
  }, () => appendClearPageTitle())
  signal.addEventListener('abort', () => {
    observer.disconnect()
    restoreOriginalPageTitle()
  }, { once: true })
}
