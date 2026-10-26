import { mutationObserve } from '@/core/observer'

const clearTitle = (value: string) => {
  if (/bilibili\s+Clear(?:_哔哩哔哩)?$/i.test(value)) { return value }
  if (/bilibili(?:_哔哩哔哩)?$/i.test(value)) {
    return value.replace(/bilibili(?=(?:_哔哩哔哩)?$)/i, 'bilibili Clear')
  }
  return `${value} · Bilibili Clear`
}

/** Follow native SPA title updates without accumulating suffixes or changing iframe titles. */
export const markClearPageTitle = (signal: AbortSignal) => {
  if (signal.aborted || window.top !== window.self || !document.head) { return }
  let original = document.title
  let written = ''
  const sync = () => {
    const current = document.title.trim()
    if (!current || current === written) { return }
    original = document.title
    written = clearTitle(current)
    if (document.title !== written) { document.title = written }
  }
  const [observer] = mutationObserve([document.head], {
    childList: true, subtree: true, characterData: true,
  }, sync)
  signal.addEventListener('abort', () => {
    observer.disconnect()
    if (document.title === written) { document.title = original }
  }, { once: true })
}
