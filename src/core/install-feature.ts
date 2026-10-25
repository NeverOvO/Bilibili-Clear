import { ComponentMetadata, FeatureBase } from '@/components/types'
import { installComponent } from '@/components/user-component'
import { getHook } from '@/plugins/hook'
import { installPlugin, PluginMetadata } from '@/plugins/plugin'
import { installStyle, UserStyle } from '@/plugins/style'
import { getBundledFeatureForUrl } from './homefix'
import { isFeatureAcceptable } from './version'

type FeatureType = (ComponentMetadata | PluginMetadata | UserStyle) & FeatureBase
const isComponent = (item: FeatureType): item is ComponentMetadata =>
  typeof (item as ComponentMetadata)?.entry === 'function'
const isPlugin = (item: FeatureType): item is PluginMetadata =>
  typeof (item as PluginMetadata)?.setup === 'function'
const isStyle = (item: FeatureType): item is UserStyle =>
  typeof (item as UserStyle)?.style === 'string'

/** 如果输入的功能链接是 .zip, 则尝试解压. 仅支持单个功能, 不能批量, 只是为了能方便在 GitHub 直接以 .zip 格式分享功能. */
export const tryParseZip = async (url: string) => {
  const { FflateLibrary } = await import('./runtime-library')
  const { monkey } = await import('../core/ajax')
  const isZip = url.endsWith('.zip')
  const responseType = isZip ? 'blob' : 'text'
  const response = (await monkey({ url, method: 'GET', responseType })) as Blob | string
  if (!isZip || typeof response === 'string') {
    return response as string
  }
  const fflate = await FflateLibrary
  const buffer = new Uint8Array(await response.arrayBuffer())
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    fflate.unzip(buffer, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
  const fileNames = Object.keys(files)
  if (fileNames.length === 0) {
    throw new Error('Empty zip file')
  }
  return new TextDecoder().decode(files[fileNames[0]])
}
export const installFeatureFromCode = async (
  code: string,
  url?: string,
  expectedName?: string,
  expectedType?: 'component' | 'plugin' | 'style',
): Promise<{
  metadata: FeatureType
  message: string
}> => {
  const { loadFeatureCode } = await import('../core/external-input')
  const item = loadFeatureCode(code) as FeatureType
  if (
    !item ||
    typeof item.name !== 'string' ||
    !item.name.trim() ||
    ['__proto__', 'prototype', 'constructor'].includes(item.name)
  ) {
    throw new Error('无效的功能元数据')
  }
  if (expectedName && item.name !== expectedName) {
    throw new Error('更新文件与已安装功能名称不一致，已取消更新')
  }
  if (!(await isFeatureAcceptable(item))) {
    throw new Error(`功能要求本体兼容版本 ${item.coreVersion}，请先更新 Bilibili Clear。`)
  }
  const { type, installer } = (() => {
    if (isComponent(item)) {
      return {
        type: 'component',
        installer: () => installComponent(code, item),
      }
    }
    if (isPlugin(item)) {
      return {
        type: 'plugin',
        installer: () => installPlugin(code, item),
      }
    }
    if (isStyle(item)) {
      return {
        type: 'style',
        installer: () => installStyle(item),
      }
    }
    throw new Error('无效的功能代码')
  })()

  if (expectedType && type !== expectedType) {
    throw new Error('更新文件与已安装功能类型不一致，已取消更新')
  }
  const { before, after } = getHook(`user${lodash.startCase(type)}s.add`, code, url)
  await before()
  const installerResult = await installer()
  await after(installerResult.metadata)
  return installerResult
}
export const installFeature = async (
  url: string,
): Promise<{
  metadata: FeatureType
  message: string
}> => {
  const sourceUrl = url.trim()
  const bundled = getBundledFeatureForUrl(sourceUrl)
  if (bundled) {
    throw new Error(`「${bundled.displayName}」已内置，请通过更新 Bilibili Clear 升级该功能。`)
  }
  const code = await tryParseZip(sourceUrl)
  return installFeatureFromCode(code, sourceUrl)
}
