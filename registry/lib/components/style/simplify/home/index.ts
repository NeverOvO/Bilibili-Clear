import { defineSwitchMetadata, wrapSwitchOptions } from '@/components/switch-options'
import { mainSiteUrls } from '@/core/utils/urls'

// Keep the v2 option keys so existing exports can be imported unchanged.
const switchMetadata = defineSwitchMetadata({
  name: 'simplifyOptions',
  switches: {
    carousel: { defaultValue: false, displayName: '轮播图' },
    categories: { defaultValue: false, displayName: '分区栏' },
    trends: { defaultValue: false, displayName: '推荐视频流（含活动/热门）' },
    online: { defaultValue: false, displayName: '在线列表(旧)' },
    'ext-box': { defaultValue: false, displayName: '电竞赛事(旧)' },
    special: { defaultValue: false, displayName: '特别推荐(旧)' },
    contact: { defaultValue: false, displayName: '联系方式' },
    elevator: { defaultValue: false, displayName: '右侧分区导航(旧)' },
  },
})

const enable = () => document.documentElement.classList.add('homefix-simplify-home')

export const component = wrapSwitchOptions(switchMetadata)({
  name: 'simplifyHome',
  displayName: '简化首页',
  tags: [componentsTags.style],
  urlInclude: [
    ...mainSiteUrls,
    /^https:\/\/www\.bilibili\.com\/(?:index\.html)?(?:[?#].*)?$/,
  ],
  instantStyles: [{ name: 'simplifyHome', style: () => import('./home.scss') }],
  // The feed homepage has no legacy category sections to wait for.
  entry: enable,
  reload: enable,
  unload: () => document.documentElement.classList.remove('homefix-simplify-home'),
})
