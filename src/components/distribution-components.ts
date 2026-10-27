import type { ComponentMetadata } from './types'
import manifest from '@/core/distribution-manifest.json'
import publicDefaults from '@/core/distribution-defaults.json'

/** Modules are evaluated after the userscript globals and core settings exist. */
const loaders: Record<string, () => Promise<{ component: ComponentMetadata<any> }>> = {
  clearHome: () => import('../../registry/lib/components/style/clear-home'),
  ipShow: () => import('../../registry/lib/components/utils/ip-show'),
  downloadSubtitle: () => import('../../registry/lib/components/video/subtitle/download'),
  viewCover: () => import('../../registry/lib/components/utils/view-cover'),
  hideVideoTopMask: () => import('../../registry/lib/components/style/hide/video/top-mask'),
  foldComments: () => import('../../registry/lib/components/feeds/fold-comments'),
  fullVideoDescription: () => import('../../registry/lib/components/video/full-description'),
  simplifyComments: () => import('../../registry/lib/components/style/simplify/comments'),
  unfoldFeeds: () => import('../../registry/lib/components/feeds/unfold'),
  disableScrollVolume: () =>
    import('../../registry/lib/components/video/player/disable-scroll-volume'),
  disableSpecialDanmaku: () => import('../../registry/lib/components/style/special-danmaku'),
  removePromotions: () => import('../../registry/lib/components/utils/remove-promotions'),
  liveGiftBox: () => import('../../registry/lib/components/live/gift-box'),
  badgeKeepalive: () => import('../../registry/lib/components/live/badge-keepalive'),
  checkInCenter: () => import('../../registry/lib/components/utils/check-in-center'),
  downloadAudio: () => import('../../registry/lib/components/utils/download-audio'),
  downloadVideo: () => import('../../registry/lib/components/video/download'),
  customNavbar: () => import('../../registry/lib/components/style/custom-navbar'),
  downloadDanmaku: () => import('../../registry/lib/components/video/danmaku/download'),
  subscribeTimeShow: () => import('../../registry/lib/components/utils/subscribe-time-show'),
  hideLivePlayerBlur: () => import('../../registry/lib/components/live/hide-player-blur'),
  simplifyLiveroom: () => import('../../registry/lib/components/style/simplify/live'),
  downloadEmoticons: () => import('../../registry/lib/components/utils/download-emoticons'),
  removeLiveWatermark: () => import('../../registry/lib/components/live/remove-watermark'),
  deleteFeeds: () => import('../../registry/lib/components/feeds/del-feeds'),
  copyFeedsLink: () => import('../../registry/lib/components/feeds/copy-link'),
  hideRelatedVideos: () => import('../../registry/lib/components/style/hide/video/related-videos'),
  collapseLiveSideBar: () => import('../../registry/lib/components/live/side-bar'),
  simplifyHome: () => import('../../registry/lib/components/style/simplify/home'),
  disableFeedsDetails: () => import('../../registry/lib/components/feeds/disable-details'),
  columnUnlock: () => import('../../registry/lib/components/utils/column-unlock'),
  blackList: () => import('../../registry/lib/components/utils/black-list'),
  hideRecommendedLive: () =>
    import('../../registry/lib/components/style/hide/video/recommended-live'),
  fullFeedsContent: () => import('../../registry/lib/components/feeds/full-content'),
  liveDanmakuSendbar: () => import('../../registry/lib/components/live/danmaku-sendbar'),
  removePlayerPopup: () => import('../../registry/lib/components/video/player/remove-popup'),
  keymap: () => import('../../registry/lib/components/utils/keymap'),
}

export const distributionComponents: ComponentMetadata[] = []

export const loadDistributionComponents = async () => {
  const { components, componentsMap } = await import('./component')
  const { settings, defaultSettings, componentToSettings } = await import('@/core/settings')
  for (const item of manifest.components) {
    if (componentsMap[item.name]) {
      continue
    }
    try {
      const { component } = await loaders[item.name]()
      const preferences = publicDefaults[item.name] ?? {}
      for (const [key, value] of Object.entries(preferences)) {
        if (component.options?.[key]) {
          component.options[key].defaultValue = lodash.cloneDeep(value)
        }
      }
      component.enabledByDefault = true
      const defaults = componentToSettings(component)
      defaultSettings.components[item.name] = lodash.cloneDeep(defaults)
      const existing = settings.components[item.name]
      if (existing) {
        // Arrays are user choices: fill missing option keys without merging array items.
        for (const [key, value] of Object.entries(defaults.options)) {
          if (existing.options[key] === undefined) {
            existing.options[key] = lodash.cloneDeep(value)
          }
        }
      } else {
        settings.components[item.name] = lodash.cloneDeep(defaults)
      }
      distributionComponents.push(component)
      components.push(component)
      componentsMap[item.name] = component
    } catch (error) {
      console.error(`[Bilibili Clear] 内置功能加载失败: ${item.displayName}`, error)
    }
  }
}
