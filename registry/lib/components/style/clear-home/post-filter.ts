import type { FollowingItem } from './following'

export interface FoldedPostGroup {
  representative: FollowingItem
  items: FollowingItem[]
  reasons: string[]
}
interface Fingerprint {
  authorId: string
  timestamp: number
  complete: boolean
  body: string
  images: string
  grams: Set<string>
  marketing: boolean
}
const week = 7 * 24 * 60 * 60 * 1000
const normalizeBody = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
const imageKey = (url: string) =>
  url
    .split('?')[0]
    .split('@')[0]
    .replace(/^https?:\/\/[^/]+/, '')
const gramsOf = (value: string) => {
  const grams = new Set<string>()
  // Sample long text evenly instead of letting large articles dominate comparison work.
  const step = Math.max(1, Math.floor(value.length / 800))
  for (let i = 0; i + 3 <= value.length; i += step) {
    grams.add(value.slice(i, i + 3))
  }
  return grams
}
const marketingText = (value: string) => {
  const context = /京东|淘宝|天猫|拼多多|唯品会|抖音商城|优惠券|领券|返利|返现|红包/.test(value)
  const action =
    /点击|扫码|扫描|下单|抢购|领取|领券|开红包|蓝链|口令|进群|链接|评论区|主页|置顶/.test(value)
  const offer =
    /红包|优惠券|补贴|返现|返利|满减|折扣|低至|到手价|限时|白嫖|省钱|现金|福利群|\d+(?:\.\d+)?元/.test(
      value,
    )
  return context && action && offer
}
const compareFingerprints = (a: Fingerprint, b: Fingerprint) => {
  // Missing text can make distinct posts look identical until their original body arrives.
  if (!a.complete || !b.complete) {
    return false
  }
  if (Math.abs(a.timestamp - b.timestamp) > week) {
    return false
  }
  const sameAuthor = a.authorId === b.authorId
  // A common reaction image or short greeting alone is not a duplicated post.
  if (a.images && a.images === b.images && !a.body && !b.body && sameAuthor) {
    return true
  }
  const minimum = sameAuthor ? 48 : 80
  if (Math.min(a.body.length, b.body.length) < minimum) {
    return false
  }
  if (a.body === b.body) {
    return a.images === b.images || (a.marketing && b.marketing)
  }
  if (Math.min(a.body.length, b.body.length) / Math.max(a.body.length, b.body.length) < 0.88) {
    return false
  }
  if (a.images !== b.images && !(a.marketing && b.marketing)) {
    return false
  }
  // Across creators, fuzzy matching needs commercial language or identical pictures.
  if (!sameAuthor && !(a.marketing && b.marketing) && !(a.images && a.images === b.images)) {
    return false
  }
  let intersection = 0
  const smaller = a.grams.size <= b.grams.size ? a.grams : b.grams
  const larger = smaller === a.grams ? b.grams : a.grams
  smaller.forEach(gram => {
    if (larger.has(gram)) {
      intersection++
    }
  })
  return (2 * intersection) / Math.max(1, a.grams.size + b.grams.size) >= 0.92
}

interface CachedFingerprint {
  title: string
  text: string
  images: string[]
  value: Fingerprint
}
// Weak keys follow the feed's lifetime: account changes and discarded pages do not retain
// their text here. Card status/render updates reuse normalized text and sampled grams.
const fingerprints = new WeakMap<FollowingItem, CachedFingerprint>()
const fingerprintOf = (item: FollowingItem): Fingerprint => {
  const cached = fingerprints.get(item)
  if (
    cached &&
    cached.title === item.title &&
    cached.text === item.text &&
    cached.value.authorId === item.author.id &&
    cached.value.timestamp === item.timestamp &&
    cached.value.complete === (item.postContentStatus === 'resolved') &&
    cached.images.length === item.images.length &&
    cached.images.every((image, index) => image === item.images[index])
  ) {
    return cached.value
  }
  const source = `${item.title}\n${item.text}`
  const body = normalizeBody(source)
  const value: Fingerprint = {
    authorId: item.author.id,
    timestamp: item.timestamp,
    complete: item.postContentStatus === 'resolved',
    body,
    images: item.images.map(imageKey).sort().join('|'),
    grams: gramsOf(body),
    marketing: marketingText(source),
  }
  fingerprints.set(item, { title: item.title, text: item.text, images: [...item.images], value })
  return value
}
const comparisons = new WeakMap<
  Fingerprint,
  { values: WeakMap<Fingerprint, boolean>; count: number }
>()
const similar = (a: Fingerprint, b: Fingerprint) => {
  let cached = comparisons.get(a)
  if (cached?.values.has(b)) {
    return cached.values.get(b)
  }
  const result = compareFingerprints(a, b)
  // Bound the number of comparison entries per live card even in an all-promotions feed.
  if (!cached) {
    cached = { values: new WeakMap(), count: 0 }
    comparisons.set(a, cached)
  }
  if (cached.count < 64) {
    cached.values.set(b, result)
    cached.count++
  }
  return result
}
interface PostGroup {
  signature: Fingerprint
  items: FollowingItem[]
  marketing: boolean
  order: number
}
const appendIndex = (index: Map<string, PostGroup[]>, key: string, group: PostGroup) => {
  const entries = index.get(key)
  if (entries) {
    entries.push(group)
  } else {
    index.set(key, [group])
  }
}

/** Local, reversible presentation only; never deletes, reports or alters original posts. */
export const groupSuspectedPosts = (posts: FollowingItem[]) => {
  const groups: PostGroup[] = []
  const byImages = new Map<string, PostGroup[]>()
  const byAuthorImages = new Map<string, PostGroup[]>()
  const byBody = new Map<string, PostGroup[]>()
  const promotions: PostGroup[] = []
  const seenIds = new Set<string>()
  for (const item of posts) {
    if (seenIds.has(item.id)) {
      continue
    }
    seenIds.add(item.id)
    const fingerprint = fingerprintOf(item)
    const authorImages = `${fingerprint.authorId}:${fingerprint.images}`
    // The existing rules only permit matching shared pictures, identical text, or two
    // marketing posts. Same-author text-only posts may additionally match fuzzily.
    const candidates = fingerprint.complete
      ? new Set<PostGroup>([
          ...(fingerprint.images ? byImages.get(fingerprint.images) || [] : []),
          ...(byAuthorImages.get(authorImages) || []),
          ...(fingerprint.body.length >= 48 ? byBody.get(fingerprint.body) || [] : []),
          ...(fingerprint.marketing ? promotions : []),
        ])
      : new Set<PostGroup>()
    let existing: PostGroup | undefined
    for (const group of candidates) {
      if ((!existing || group.order < existing.order) && similar(group.signature, fingerprint)) {
        existing = group
      }
    }
    if (existing) {
      existing.items.push(item)
      existing.marketing ||= fingerprint.marketing
    } else {
      const group = {
        signature: fingerprint,
        items: [item],
        marketing: fingerprint.marketing,
        order: groups.length,
      }
      groups.push(group)
      if (fingerprint.complete) {
        if (fingerprint.images) {
          appendIndex(byImages, fingerprint.images, group)
        }
        appendIndex(byAuthorImages, authorImages, group)
        if (fingerprint.body.length >= 48) {
          appendIndex(byBody, fingerprint.body, group)
        }
        if (fingerprint.marketing) {
          promotions.push(group)
        }
      }
    }
  }
  const visible: FollowingItem[] = []
  const folded: FoldedPostGroup[] = []
  for (const group of groups) {
    if (!group.marketing && group.items.length === 1) {
      visible.push(group.items[0])
      continue
    }
    folded.push({
      representative: group.items[0],
      items: group.items,
      reasons: [
        ...(group.marketing ? ['含促销或领券引导'] : []),
        ...(group.items.length > 1 ? [`7 天内 ${group.items.length} 条高度重复`] : []),
      ],
    })
  }
  return { visible, folded }
}
