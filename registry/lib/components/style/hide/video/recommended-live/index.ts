import { defineComponentMetadata } from '@/components/define'
import { addComponentListener, removeComponentListener } from '@/core/settings'
import { videoUrls } from '@/core/utils/urls'

const homeLiveOption = 'hideRecommendedLive.hideHomeLive'
const homeLiveClass = 'hide-recommended-home-live'
const updateHomeLive = (value: boolean) => {
  document.documentElement.classList.toggle(homeLiveClass, value)
}
const entry = () => {
  addComponentListener(homeLiveOption, updateHomeLive, true)
}

export const component = defineComponentMetadata({
  name: 'hideRecommendedLive',
  entry,
  reload: entry,
  unload: () => {
    removeComponentListener(homeLiveOption, updateHomeLive)
    document.documentElement.classList.remove(homeLiveClass)
  },
  instantStyles: [
    {
      name: 'hideRecommendedLive',
      style: () => import('./recommended-live.scss'),
    },
  ],
  displayName: '隐藏直播推荐',
  tags: [componentsTags.style, componentsTags.video],
  urlInclude: [...videoUrls, /^https?:\/\/www\.bilibili\.com\/(?:index\.html)?(?:#.*)?$/],
  options: {
    hideHomeLive: {
      displayName: '隐藏首页直播推荐',
      defaultValue: false,
    },
  },
})
