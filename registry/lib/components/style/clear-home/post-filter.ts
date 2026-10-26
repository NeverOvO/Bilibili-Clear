import type { FollowingItem } from './following'

export interface FoldedPostGroup {
  representative: FollowingItem
  items: FollowingItem[]
  reasons: string[]
}
interface Fingerprint {
  item: FollowingItem
  body: string
  images: string
  grams: Set<string>
  marketing: boolean
}
const week = 7 * 24 * 60 * 60 * 1000
const normalizeBody = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/https?:\/\/\S+/gi, '')
  .replace(/[^\p{L}\p{N}]/gu, '')
const imageKey = (url: string) => url.split('?')[0].split('@')[0].replace(/^https?:\/\/[^/]+/, '')
const gramsOf = (value: string) => {
  const grams = new Set<string>()
  // Sample long text evenly instead of letting large articles dominate comparison work.
  const step = Math.max(1, Math.floor(value.length / 800))
  for (let i = 0; i + 3 <= value.length; i += step) { grams.add(value.slice(i, i + 3)) }
  return grams
}
const marketingText = (value: string) => {
  const context = /京东|淘宝|天猫|拼多多|唯品会|抖音商城|优惠券|领券|返利|返现|红包/.test(value)
  const action = /点击|扫码|扫描|下单|抢购|领取|领券|开红包|蓝链|口令|进群|链接|评论区|主页|置顶/.test(value)
  const offer = /红包|优惠券|补贴|返现|返利|满减|折扣|低至|到手价|限时|白嫖|省钱|现金|福利群|\d+(?:\.\d+)?元/.test(value)
  return context && action && offer
}
const similar = (a: Fingerprint, b: Fingerprint) => {
  if (Math.abs(a.item.timestamp - b.item.timestamp) > week) { return false }
  const sameAuthor = a.item.author.id === b.item.author.id
  // A common reaction image or short greeting alone is not a duplicated post.
  if (a.images && a.images === b.images && !a.body && !b.body && sameAuthor) { return true }
  const minimum = sameAuthor ? 48 : 80
  if (Math.min(a.body.length, b.body.length) < minimum) { return false }
  if (a.body === b.body) { return a.images === b.images || (a.marketing && b.marketing) }
  if (Math.min(a.body.length, b.body.length) / Math.max(a.body.length, b.body.length) < .88) { return false }
  if (a.images !== b.images && !(a.marketing && b.marketing)) { return false }
  // Across creators, fuzzy matching needs commercial language or identical pictures.
  if (!sameAuthor && !(a.marketing && b.marketing) && !(a.images && a.images === b.images)) { return false }
  let intersection = 0
  const smaller = a.grams.size <= b.grams.size ? a.grams : b.grams
  const larger = smaller === a.grams ? b.grams : a.grams
  smaller.forEach(gram => { if (larger.has(gram)) { intersection++ } })
  return 2 * intersection / Math.max(1, a.grams.size + b.grams.size) >= .92
}

/** Local, reversible presentation only; never deletes, reports or alters original posts. */
export const groupSuspectedPosts = (posts: FollowingItem[]) => {
  const groups: { signature: Fingerprint; items: FollowingItem[]; marketing: boolean }[] = []
  for (const item of posts) {
    const source = `${item.title}\n${item.text}`
    const body = normalizeBody(source)
    const fingerprint: Fingerprint = {
      item, body, images: item.images.map(imageKey).sort().join('|'),
      grams: gramsOf(body), marketing: marketingText(source),
    }
    const existing = groups.find(group => similar(group.signature, fingerprint))
    if (existing) {
      existing.items.push(item)
      existing.marketing ||= fingerprint.marketing
    } else { groups.push({ signature: fingerprint, items: [item], marketing: fingerprint.marketing }) }
  }
  const visible: FollowingItem[] = []
  const folded: FoldedPostGroup[] = []
  for (const group of groups) {
    if (!group.marketing && group.items.length === 1) { visible.push(group.signature.item); continue }
    folded.push({
      representative: group.signature.item,
      items: group.items,
      reasons: [
        ...(group.marketing ? ['含促销或领券引导'] : []),
        ...(group.items.length > 1 ? [`7 天内 ${group.items.length} 条高度重复`] : []),
      ],
    })
  }
  return { visible, folded }
}
