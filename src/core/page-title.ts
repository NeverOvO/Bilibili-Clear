interface PageTitleMark {
  original: string
  written: string
}

// Keep the unmodified page title in memory, so filename formatting never needs to
// guess whether a trailing "Clear" is a native title or our browser-tab suffix.
const marks = new WeakMap<Document, PageTitleMark>()
const withoutNotificationCount = (value: string) =>
  value.replace(/^(?:\(\d+\)|（\d+）|\[\d+\])\s*/, '')

export const getOriginalPageTitle = (target: Document = document): string => {
  const mark = marks.get(target)
  return mark && target.title === mark.written ? mark.original : target.title
}

export const appendClearPageTitle = (target: Document = document) => {
  const current = target.title
  const previous = marks.get(target)
  if (!current.trim() || current === previous?.written) { return }
  // Native counters may prepend text or replace a leading numeric count. When
  // the remaining title matches our known output, remove only our known suffix.
  const reusesWrittenTitle = previous && (current.endsWith(previous.written) ||
    withoutNotificationCount(current) === withoutNotificationCount(previous.written))
  const original = reusesWrittenTitle
    ? current.slice(0, current.length - ' Clear'.length)
    : current
  // The complete native title, including its Bilibili suffix, stays untouched.
  const written = `${original} Clear`
  marks.set(target, { original, written })
  if (current !== written) { target.title = written }
}

export const restoreOriginalPageTitle = (target: Document = document) => {
  const mark = marks.get(target)
  marks.delete(target)
  if (mark && target.title === mark.written) { target.title = mark.original }
}
