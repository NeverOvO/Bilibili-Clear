import { mountVueComponent } from '@/core/utils'
import { isNavbarActive } from '../lifecycle'

let navbarSettingsVM: Vue & {
  toggle: () => void
  open: boolean
  triggerElement: HTMLElement
}
export const setTriggerElement = (element: HTMLElement) => {
  if (!navbarSettingsVM) {
    return
  }
  navbarSettingsVM.triggerElement = element
}
export const loadNavbarSettings = async () => {
  if (navbarSettingsVM) {
    return false
  }
  const NavbarSettings = await import('./NavbarSettings.vue').then(m => m.default)
  navbarSettingsVM = mountVueComponent(NavbarSettings)
  document.body.insertAdjacentElement('beforeend', navbarSettingsVM.$el)
  return true
}
export const closeNavbarSettings = () => {
  if (navbarSettingsVM) {
    navbarSettingsVM.open = false
  }
}
export const toggleNavbarSettings = async () => {
  if (!isNavbarActive()) {
    return
  }
  if (!navbarSettingsVM) {
    await loadNavbarSettings()
  }
  if (isNavbarActive()) {
    navbarSettingsVM?.toggle()
  }
}
