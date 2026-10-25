import { addNavbarListener } from './lifecycle'

export enum NavbarNotifyStyle {
  Number = '数字',
  Hidden = '隐藏',
  Dot = '点状',
}

export const setupNotifyStyle = () => {
  const map = {
    [NavbarNotifyStyle.Number]: 'number',
    [NavbarNotifyStyle.Hidden]: 'hidden',
    [NavbarNotifyStyle.Dot]: 'dot',
  }
  addNavbarListener(
    'customNavbar.notifyStyle',
    (value: NavbarNotifyStyle) => {
      document.documentElement.setAttribute('data-navbar-notify-style', map[value])
    },
    true,
  )
}
