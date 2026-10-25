import { meta } from '@/core/meta'
import { getGeneralSettings, getComponentSettings } from '@/core/settings'
import { useScopedConsole } from '@/core/utils/log'
import { descendingSort } from '@/core/utils/sort'
import {
  name,
  CheckUpdateConfig,
  defaultExistPredicate,
  getUpdateDueTime,
  localhost,
  CheckSingleTypeUpdate,
  UpdateRecord,
  UpdateCheckItem,
  CheckSingleTypeUpdateConfig,
} from './utils'
import type { Options } from '.'
import { isDataSaveMode } from '@/core/utils'

export const checkUpdate = async (config: CheckUpdateConfig) => {
  const {
    items,
    existPredicate = defaultExistPredicate,
    filterNames = [],
    force = false,
    maxCount = Infinity,
    featureType,
  } = config
  if (isDataSaveMode()) {
    return '当前为流量计费网络, 跳过更新检查.'
  }
  const now = Number(new Date())
  const { devMode } = getGeneralSettings()
  const { options } = getComponentSettings<Options>(name)
  // Remove uninstalled items
  Object.keys(items)
    .filter(it => !existPredicate(it))
    .forEach(key => {
      delete items[key]
    })
  const shouldUpdate = (itemName: string) => {
    if (filterNames.length === 0) {
      return true
    }
    return filterNames.includes(itemName)
  }
  let startedCount = 0
  const updateItems = Object.entries(items)
    .filter(([itemName, item]) => shouldUpdate(itemName) && Boolean(item.url))
    .sort(([, a], [, b]) =>
      (a.lastUpdateAttempt ?? a.lastUpdateCheck ?? 0) -
      (b.lastUpdateAttempt ?? b.lastUpdateCheck ?? 0),
    )
  const results = await Promise.allSettled(
    updateItems.map(async ([itemName, item]) => {
      const { url, alwaysUpdate } = item
      const isDebugItem = alwaysUpdate && devMode
      if (!isDebugItem && now < getUpdateDueTime(item, options.minimumDuration) && !force) {
        return `[${itemName}] 未超过更新间隔期, 已跳过`
      }
      if (startedCount >= maxCount && !force) {
        return `[${itemName}] 已到达单次更新量上限 (${maxCount} 个), 已跳过`
      }
      startedCount++
      item.lastUpdateAttempt = now
      const sourceUrl = url
      let finalUrl = sourceUrl
      if (localhost.test(url) && options.localPortOverride) {
        const port = Number(options.localPortOverride)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('本地组件端口必须为 1 到 65535 的整数')
        }
        const localUrl = new URL(url)
        localUrl.port = String(port)
        finalUrl = localUrl.href
      }
      const code: string = await coreApis.ajax.monkey({ url: finalUrl })
      // 需要再检查下是否还安装着, 有可能正好在下载途中被卸载
      if (!(itemName in items) || items[itemName] !== item || item.url !== url) {
        return `[${itemName}] 已被卸载, 取消更新`
      }
      if (!code) {
        return `[${itemName}] 更新下载失败, 取消更新`
      }
      const { installFeatureFromCode } = await import('@/core/install-feature')
      const { message } = await installFeatureFromCode(code, sourceUrl, itemName, featureType)
      item.lastUpdateCheck = Number(new Date())
      return `[${itemName}] ${message}`
    }),
  )
  return results
    .map((r, index) => {
      if (r.status === 'fulfilled') {
        return r.value
      }
      const message = r.reason?.message ?? String(r.reason)
      return `[${updateItems[index][0]}] ${message}`
    })
    .join('\n')
    .trim()
}
export const checkComponentsUpdate: CheckSingleTypeUpdate = async config => {
  const { options } = getComponentSettings(name)
  const { components } = options.urls as UpdateRecord
  return checkUpdate({
    items: components,
    featureType: 'component',
    ...config,
  })
}
export const checkPluginsUpdate: CheckSingleTypeUpdate = async config => {
  const { options } = getComponentSettings(name)
  const { plugins } = options.urls as UpdateRecord
  return checkUpdate({
    items: plugins,
    featureType: 'plugin',
    ...config,
  })
}
export const checkStylesUpdate: CheckSingleTypeUpdate = async config => {
  const { options } = getComponentSettings(name)
  const { styles } = options.urls as UpdateRecord
  return checkUpdate({
    items: styles,
    featureType: 'style',
    ...config,
  })
}

const reload =
  <T extends any[]>(method: (...args: T) => Promise<any>) =>
  async (...args: T) => {
    await method(...args)
    window.location.reload()
  }
const checkByName = (method: CheckSingleTypeUpdate) =>
  reload(async (...itemNames: string[]) => {
    await method({ filterNames: itemNames, force: true })
  }) as (...itemNames: string[]) => Promise<void>

export const checkAllUpdate = async (config: CheckSingleTypeUpdateConfig) => {
  const { options } = getComponentSettings(name)
  const console = useScopedConsole('检查所有更新')
  console.log('开始检查更新')
  const updateMessages = [
    (await checkComponentsUpdate(config)) || '暂无组件更新',
    (await checkPluginsUpdate(config)) || '暂无插件更新',
    (await checkStylesUpdate(config)) || '暂无样式更新',
  ]
  options.lastUpdateCheck = Number(new Date())
  options.lastInstalledVersion = meta.version
  console.groupCollapsed('完成更新检查')
  updateMessages.forEach(message => console.log(message))
  console.groupEnd()
}
export const silentCheckUpdate = () =>
  checkAllUpdate({
    maxCount: getComponentSettings<Options>(name).options.maxUpdateCount,
  })
export const silentCheckUpdateAndReload = reload(silentCheckUpdate)

export const forceCheckUpdate = () =>
  checkAllUpdate({
    force: true,
  })
export const forceCheckUpdateAndReload = reload(forceCheckUpdate)

export const checkComponentsByName = checkByName(checkComponentsUpdate)
export const checkPluginsByName = checkByName(checkPluginsUpdate)
export const checkStylesByName = checkByName(checkStylesUpdate)
export const checkLastFeature = async () => {
  const { options } = getComponentSettings(name)
  const items = Object.values(options.urls)
    .flatMap(it => Object.entries(it))
    .map(([key, record]: [string, UpdateCheckItem]) => ({
      key,
      time: record.lastUpdateCheck,
      item: record,
    }))
    .sort(descendingSort(it => it.time))
  const [firstItem] = items
  if (!firstItem) {
    console.log('没有找到最近更新的功能')
    return
  }
  await checkUpdate({
    items: { [firstItem.key]: firstItem.item },
    force: true,
  })
  window.location.reload()
}
