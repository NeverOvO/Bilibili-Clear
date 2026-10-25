import { getComponentSettings } from '@/core/settings'
import { sq } from '@/core/spin-query'
import { matchUrlPattern } from '@/core/utils'
import { mainSiteUrls, matchCurrentPage } from '@/core/utils/urls'
import { addNavbarListener, isNavbarActive, removeNavbarListener } from './lifecycle'

let generation = 0
let cleanup: (() => void) | undefined

export const stopTransparentFill = () => {
  generation += 1
  cleanup?.()
  cleanup = undefined
}

const setupTransparentFill = (vm: { toggleStyle: (value: boolean, style: string) => void }) => {
  const update = () => {
    vm.toggleStyle(
      Boolean(getComponentSettings('customNavbar').options.transparent) &&
        !getComponentSettings('hideBanner').enabled,
      'transparent',
    )
  }
  addNavbarListener('customNavbar.transparent', update, true)
  addNavbarListener('hideBanner', update)
  cleanup = () => {
    removeNavbarListener('customNavbar.transparent', update)
    removeNavbarListener('hideBanner', update)
    vm.toggleStyle(false, 'transparent')
  }
}

const transparentFillUrls = ['//music.bilibili.com/', '//space.bilibili.com/']

/** 检查是否应用透明填充；停用、无横幅或轮询超时时保持不透明。 */
export const checkTransparentFill = async (vm: {
  toggleStyle: (value: boolean, style: string) => void
}) => {
  stopTransparentFill()
  const currentGeneration = generation
  vm.toggleStyle(false, 'transparent')
  if (!isNavbarActive()) {
    return
  }
  if (transparentFillUrls.some(url => matchUrlPattern(url))) {
    setupTransparentFill(vm)
    return
  }
  if (!matchCurrentPage(mainSiteUrls)) {
    return
  }
  const banners = await sq(
    () =>
      dqa(
        '.animated-banner video, .banner-img img, #banner_link, .international-header .bili-banner, .bili-header__banner',
      ),
    (candidates, stop) => {
      if (currentGeneration !== generation || !isNavbarActive()) {
        stop()
        return true
      }
      return candidates.some(
        (banner: HTMLElement) =>
          Boolean(banner.style.backgroundImage) ||
          Boolean((banner as HTMLVideoElement | HTMLImageElement).src) ||
          Boolean(banner.querySelector('.animated-banner')),
      )
    },
  )
  if (!banners?.length || currentGeneration !== generation || !isNavbarActive()) {
    return
  }
  setupTransparentFill(vm)
}
