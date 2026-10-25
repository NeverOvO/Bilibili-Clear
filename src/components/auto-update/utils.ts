import { settings } from '@/core/settings'
import manifest from '@/core/distribution-manifest.json'

export const name = 'autoUpdate'
export interface UpdateCheckItem {
  url: string
  lastUpdateCheck: number
  /** 最近一次尝试，失败也记录，避免失败条目反复占用队列。 */
  lastUpdateAttempt?: number
  installTime: number
  alwaysUpdate?: boolean
}
export const localhost = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/
export type UpdateRecord = Record<string, Record<string, UpdateCheckItem>>
export interface CheckSingleTypeUpdateConfig {
  filterNames?: string[]
  force?: boolean
  maxCount?: number
}
export type CheckSingleTypeUpdate = (config?: CheckSingleTypeUpdateConfig) => Promise<string>
export interface CheckUpdateConfig extends CheckSingleTypeUpdateConfig {
  items: Record<string, UpdateCheckItem>
  featureType?: 'component' | 'plugin' | 'style'
  existPredicate?: (name: string) => boolean
  // installer: (code: string) => Promise<{ message: string }>
}
export const isLocalItem = (url: string) => localhost.test(url)
const bundledNames = new Set([...manifest.components, ...manifest.plugins].map(item => item.name))
export const getUpdateDueTime = (item: UpdateCheckItem, minimumDuration: number) => {
  const attempt = item.lastUpdateAttempt ?? item.lastUpdateCheck ?? 0
  const failed = attempt > (item.lastUpdateCheck ?? 0)
  const interval = failed ? Math.min(minimumDuration, 15 * 60 * 1000) : minimumDuration
  return attempt + Math.max(0, interval)
}
export const defaultExistPredicate = (itemName: string) =>
  !bundledNames.has(itemName) &&
  (settings.userComponents[itemName] !== undefined ||
    settings.userPlugins[itemName] !== undefined ||
    settings.userStyles[itemName] !== undefined)
