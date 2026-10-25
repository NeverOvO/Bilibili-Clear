import {
  addComponentListener,
  getComponentSettings,
  removeComponentListener,
  ValueChangeListener,
} from '@/core/settings'

type Listener = { path: string; callback: ValueChangeListener }
const listeners = new Set<Listener>()
let active = false
let session = 0

export const getNavbarSession = () => session
export const isNavbarActive = () => active && getComponentSettings('customNavbar').enabled
export const isNavbarSessionActive = (value: number) => value === session && isNavbarActive()

/** Keep the mounted navbar's listeners dormant while the component is disabled. */
export const addNavbarListener = <T = any>(
  path: string,
  callback: ValueChangeListener<T>,
  initCall = false,
) => {
  const listener = { path, callback }
  listeners.add(listener)
  if (active) {
    addComponentListener(path, callback, initCall)
  }
}

export const removeNavbarListener = (path: string, callback: ValueChangeListener) => {
  for (const listener of listeners) {
    if (listener.path === path && listener.callback === callback) {
      if (active) {
        removeComponentListener(path, callback)
      }
      listeners.delete(listener)
    }
  }
}

export const resumeNavbarListeners = () => {
  if (active) {
    return
  }
  active = true
  session += 1
  listeners.forEach(({ path, callback }) => addComponentListener(path, callback, true))
}

export const pauseNavbarListeners = () => {
  session += 1
  if (!active) {
    return
  }
  active = false
  listeners.forEach(({ path, callback }) => removeComponentListener(path, callback))
}
