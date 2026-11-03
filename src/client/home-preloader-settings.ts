import { addComponentListener, getComponentSettings, isComponentEnabled } from '@/core/settings'
import { saveHomePreloadHint } from './home-preloader-protocol'

let listening = false

/** Install after built-in registration, including when the homepage component is disabled. */
export const syncHomePreloaderSettings = () => {
  if (listening || window.top !== window.self || location.hostname !== 'www.bilibili.com') {
    return
  }
  listening = true
  const sync = () =>
    saveHomePreloadHint(
      isComponentEnabled('clearHome') &&
        getComponentSettings('clearHome').options.mode === '关注极简',
    )
  addComponentListener('clearHome', sync)
  addComponentListener('clearHome.mode', sync)
  sync()
}
