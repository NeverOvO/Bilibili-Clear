import { startClearHomeBootstrap } from './clear-home-bootstrap'
import { recordHomeStartup, startHomeStartupDiagnostics } from './clear-home-diagnostics'

/** 初始化脚本 */
export const init = async () => {
  startHomeStartupDiagnostics()
  // The parent manages this same-origin native player. Do not mount a second enhancement UI.
  if (
    window.top !== window.self &&
    location.hostname === 'www.bilibili.com' &&
    /^\/video\//.test(location.pathname) &&
    new URLSearchParams(location.search).get('bilibili_clear_shorts') === '1'
  ) {
    return
  }
  startClearHomeBootstrap()
  // Bundle the runtime so @require fetching cannot postpone the document-start guard.
  // The subpath intentionally avoids the shared `lodash` external used by feature modules.
  recordHomeStartup('运行库初始化开始')
  window.lodash = (await import('lodash/lodash')).default
  recordHomeStartup('运行库初始化完成')
  Object.defineProperty(window, '_', {
    get() {
      console.warn('window._ is deprecated, please use window.lodash instead.')
      return window.lodash
    },
  })

  const { initVue } = await import('./init-vue')
  initVue()
  recordHomeStartup('Vue 初始化完成')

  // 跳过对多余<iframe>的加载
  // const { checkIframes } = await import('./check-iframes')
  // const skip = !checkIframes()
  // if (skip) {
  //   return
  // }

  recordHomeStartup('核心基础模块加载开始')
  const { headLoaded, raiseLifeCycleEvent, LifeCycleEventTypes } = await import('@/core/life-cycle')
  raiseLifeCycleEvent(LifeCycleEventTypes.Start)
  const { none, dq, dqa } = await import('@/core/utils')
  // dq/dqa 需要先于 core-apis 挂载, 避免其模块初始化时访问未定义的全局 (如评论区初始化)
  window.dq = dq
  window.dqa = dqa
  const { promiseLoadTrace } = await import('@/core/performance/promise-trace')
  recordHomeStartup('核心基础模块加载完成')

  recordHomeStartup('等待 head')
  await promiseLoadTrace('wait for <head>', async () => {
    // 等待<head>元素
    await headLoaded(none)
  })
  recordHomeStartup('head 已就绪')

  await promiseLoadTrace('compatibility patch', async () => {
    // 兼容性补丁
    const { compatibilityPatch } = await import('./compatibility')
    compatibilityPatch()
  })

  recordHomeStartup('核心 API 与设置加载开始')
  const { coreApis, externalApis } = await import('@/core/core-apis')
  recordHomeStartup('核心 API 与设置加载完成')
  if (
    unsafeWindow.bangumi_area_limit_hack &&
    coreApis.settings.getComponentSettings<{ disableOnBalh: boolean }>('compatibilities').options
      .disableOnBalh &&
    coreApis.utils.matchUrlPattern('//www.bilibili.com/bangumi/play/')
  ) {
    console.log('BALH detected, Bilibili Evolved is disabled.')
    return
  }

  unsafeWindow.bilibiliEvolved = externalApis
  // Keep the upstream API name for compatible extensions.
  ;(unsafeWindow as any).bilibiliClear = externalApis
  /** sand-boxed window, safe to use original name */
  window.coreApis = coreApis
  window.de = coreApis.utils.de
  window.des = coreApis.utils.des
  window.dea = coreApis.utils.dea
  window.deai = coreApis.utils.deai
  window.none = coreApis.utils.none
  window.componentsTags = coreApis.componentApis.component.componentsTags
  window.console = coreApis.utils.log.useScopedConsole({
    name: 'Bilibili Clear',
    color: '#00A0D8',
  })
  // window.console 和 console 是独立的引用
  // eslint-disable-next-line no-global-assign
  console = window.console

  const { loadDistributionComponents } = await import('@/components/distribution-components')
  recordHomeStartup('内置组件注册开始')
  await promiseLoadTrace('load built-in features', loadDistributionComponents)
  recordHomeStartup('内置组件注册完成')
  const { syncHomePreloaderSettings } = await import('./home-preloader-settings')
  syncHomePreloaderSettings()

  // Mount the selected homepage before user components, plugins or page-load delays.
  const { prepareClearHome } = await import('../../registry/lib/components/style/clear-home')
  recordHomeStartup('调用极简首页提前入口')
  prepareClearHome()

  const { loadAllUserComponents } = await import('@/components/component')
  await promiseLoadTrace('parse user components', loadAllUserComponents)

  const { preloadStyles, loadAllCustomStyles } = await import('@/core/style')
  await promiseLoadTrace('load styles', preloadStyles)
  raiseLifeCycleEvent(LifeCycleEventTypes.StyleLoaded)

  await promiseLoadTrace('load components', async () => {
    const { loadAllComponents } = await import('@/components/component')
    return Promise.all([loadAllComponents(), loadAllCustomStyles()]).catch(error => {
      console.error(error)
    })
  })
  raiseLifeCycleEvent(LifeCycleEventTypes.ComponentsLoaded)

  await promiseLoadTrace('wind up', async () => {
    const prefetchLink = document.createElement('link')
    prefetchLink.rel = 'dns-prefetch'
    prefetchLink.href = 'https://api.bilibili.com'
    document.head.insertAdjacentElement('afterbegin', prefetchLink)

    requestIdleCallback(async () => {
      const { getGeneralSettings } = await import('@/core/settings/helpers')
      const { devMode } = getGeneralSettings()
      if (devMode) {
        const { promiseLoadTime, promiseResolveTime } = await import(
          '@/core/performance/promise-trace'
        )
        const { logStats } = await import('@/core/performance/stats')
        logStats('init block', promiseLoadTime)
        logStats('init resolve', promiseResolveTime)
      }
    })
  })
  raiseLifeCycleEvent(LifeCycleEventTypes.End)
}
