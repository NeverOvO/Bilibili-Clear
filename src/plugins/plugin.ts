import { ComponentMetadata, FeatureBase } from '@/components/component'
import { CoreApis } from '@/core/core-apis'
import { deleteValue } from '@/core/utils'
import { addData, registerAndGetData, registerData } from './data'
import { addHook, getHook } from './hook'
import { getDistributionPlugins } from './distribution-plugins'

/** 插件初始化时的传入参数, 可以解构并调用 */
export interface PluginSetupParameters {
  coreApis: CoreApis
  addData: typeof addData
  addHook: typeof addHook
  registerData: typeof registerData
  registerAndGetData: typeof registerAndGetData
  getHook: typeof getHook
}

/** 插件基本信息 */
export interface PluginMinimalData extends FeatureBase {
  /** 初始化函数, 可在其中注册数据, 添加代码注入等 */
  setup: (params: PluginSetupParameters) => void | Promise<void>
  /** 插件名称 */
  name: string
  /** 显示名称, 默认同插件名称 */
  displayName?: string
}

type PartialRequired<Target, Props extends keyof Target> = Target & {
  [P in Props]-?: Target[P]
}
export type PluginMetadata = PartialRequired<PluginMinimalData, 'displayName'>

/** 可根据插件名称检索对应的内置插件 */
export const pluginsMap: { [name: string]: PluginMetadata } = {}
const builtInPluginNames = new Set<string>()
const getBuiltInPlugins = lodash.once(() => {
  const context = require.context('@/plugins', true, /index\.ts$/)
  const pluginPaths = context.keys()
  const builtIns = pluginPaths
    .map(path => {
      const m = context(path)
      if ('plugin' in m) {
        const plugin = m.plugin as PluginMetadata
        pluginsMap[plugin.name] = plugin
        builtInPluginNames.add(plugin.name)
        return plugin
      }
      return undefined
    })
    .filter(it => it !== undefined) as PluginMetadata[]
  getDistributionPlugins().forEach(plugin => {
    if (!pluginsMap[plugin.name]) {
      pluginsMap[plugin.name] = plugin
      builtInPluginNames.add(plugin.name)
      builtIns.push(plugin)
    }
  })
  return builtIns
})
/** 包含所有插件的数组 */
export const plugins: PluginMetadata[] = getBuiltInPlugins()

/**
 * 安装插件
 * @param code 插件代码
 */
export const installPlugin = async (code: string, parsedPlugin?: PluginMetadata) => {
  let plugin: PluginMetadata
  if (parsedPlugin) {
    plugin = parsedPlugin
  } else {
    try {
      const { loadFeatureCode } = await import('@/core/external-input')
      plugin = loadFeatureCode(code) as PluginMetadata
    } catch (e) {
      throw new Error('无效的插件代码', { cause: e })
    }
  }
  if (
    !plugin ||
    typeof plugin.name !== 'string' ||
    !plugin.name.trim() ||
    ['__proto__', 'prototype', 'constructor'].includes(plugin.name) ||
    typeof plugin.setup !== 'function'
  ) {
    throw new Error('无效的插件元数据')
  }
  const { settings } = await import('@/core/settings')
  if (builtInPluginNames.has(plugin.name)) {
    throw new Error(
      `不能覆盖内置插件「${plugin.displayName || plugin.name}」，请更新 Bilibili Clear。`,
    )
  }
  const { isFeatureAcceptable } = await import('@/core/version')
  if (!(await isFeatureAcceptable(plugin))) {
    throw new Error(`插件要求本体兼容版本 ${plugin.coreVersion}，请先更新 Bilibili Clear。`)
  }
  const existingPlugin = settings.userPlugins[plugin.name]
  if (existingPlugin) {
    Object.assign(existingPlugin, lodash.omit(plugin, 'setup'), {
      code,
      displayName: plugin.displayName || plugin.name,
    })
    return {
      metadata: plugin,
      message: `已更新插件'${plugin.displayName}', 刷新后生效`,
    }
  }
  const newPlugin = {
    code,
    displayName: plugin.name, // 默认等于 name
    ...lodash.omit(plugin, 'setup'),
  }
  settings.userPlugins[plugin.name] = newPlugin
  plugins.push(plugin)
  pluginsMap[plugin.name] = plugin
  // const { coreApis } = await import('../core/core-apis')
  // plugin.setup({
  //   coreApis,
  //   addData,
  //   addHook,
  //   registerData,
  //   registerAndGetData,
  //   getHook,
  // })
  return {
    metadata: plugin,
    message: `已安装插件'${plugin.displayName || plugin.name}', 刷新后生效`,
  }
}

/**
 * 卸载插件
 * @param nameOrDisplayName 插件的名称(`name`或`displayName`)
 */
export const uninstallPlugin = async (nameOrDisplayName: string) => {
  const { settings } = await import('@/core/settings')
  const existingPlugin = Object.entries(settings.userPlugins).find(
    ([name, { displayName }]) => name === nameOrDisplayName || displayName === nameOrDisplayName,
  )
  if (!existingPlugin) {
    throw new Error(`没有找到与名称'${nameOrDisplayName}'相关联的插件`)
  }
  const [name, metadata] = existingPlugin
  delete settings.userPlugins[name]
  delete pluginsMap[name]
  deleteValue(plugins, it => it.name === name)
  return {
    metadata,
    message: `已卸载插件'${metadata.displayName}', 刷新后生效`,
  }
}

/**
 * 提取组件自带的插件
 * @param component 组件
 * @returns 插件
 */
export const extractPluginFromComponent = (component: ComponentMetadata) => {
  if (!component.plugin) {
    return null
  }
  return (Array.isArray(component.plugin) ? component.plugin : [component.plugin]).map(
    plugin =>
      ({
        name: `${component.name}.plugin`,
        displayName: `${component.displayName} - 附带插件`,
        ...plugin,
      } as PluginMetadata),
  )
}
/**
 * 载入单个插件
 * @param plugin 插件基本信息
 */
export const loadPlugin = async (plugin: PluginMetadata) => {
  if (plugin.setup) {
    const { pluginLoadTrace } = await import('@/core/performance/plugin-trace')
    await pluginLoadTrace(plugin)
    const { coreApis } = await import('../core/core-apis')
    return plugin.setup({
      coreApis,
      addData,
      addHook,
      registerData,
      registerAndGetData,
      getHook,
    })
  }
  return null
}

/**
 * 载入所有插件, 包含传入组件里定义的插件, 内置的插件, 以及用户安装的插件
 * @param components 组件列表
 */
export const loadAllPlugins = async (components: ComponentMetadata[]) => {
  const { settings, getGeneralSettings } = await import('@/core/settings')
  const { loadFeatureCode } = await import('@/core/external-input/load-feature-code')
  for (const component of components) {
    const plugin = extractPluginFromComponent(component)
    if (plugin) {
      plugin.forEach(item => {
        pluginsMap[item.name] = item
        builtInPluginNames.add(item.name)
      })
      plugins.push(...plugin)
    }
  }
  for (const [name, setting] of Object.entries(settings.userPlugins)) {
    if (pluginsMap[name]) {
      continue
    }
    const { code } = setting
    let metadata: PluginMetadata
    try {
      metadata = loadFeatureCode(code) as PluginMetadata
    } catch (e) {
      console.error('从代码加载用户插件失败。代码可能包含语法错误或执行时产生了异常', {
        pluginName: name,
        error: e,
      })
      continue
    }
    if (!metadata || metadata.name !== name || pluginsMap[metadata.name]) {
      console.warn('跳过名称不匹配或重复的用户插件', name)
      continue
    }
    plugins.push(metadata)
    pluginsMap[name] = metadata
  }
  const enabledPlugins = plugins.filter(plugin => settings.plugins[plugin.name] !== false)
  return Promise.allSettled(enabledPlugins.map(loadPlugin)).then(async () => {
    if (getGeneralSettings().devMode) {
      const { pluginLoadTime, pluginResolveTime } = await import('@/core/performance/plugin-trace')
      const { logStats } = await import('@/core/performance/stats')
      logStats('plugins block', pluginLoadTime)
      logStats('plugins resolve', pluginResolveTime)
    }
  })
}
