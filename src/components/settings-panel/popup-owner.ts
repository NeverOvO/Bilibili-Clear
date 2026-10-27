import type Vue from 'vue'

type PopupOwner = Vue & { trigger?: HTMLElement }

/** Vue can associate a shared root element with its wrapper rather than VPopup. */
export const getPopupOwner = (element: HTMLElement): PopupOwner | null => {
  const find = (owner?: Vue): PopupOwner | null => {
    if (!owner || owner.$el !== element) {
      return null
    }
    if (owner.$options.name === 'VPopup') {
      return owner as PopupOwner
    }
    for (const child of owner.$children) {
      const popup = find(child)
      if (popup) {
        return popup
      }
    }
    return null
  }
  // Vue 2 exposes the component associated with the element through this field.
  // eslint-disable-next-line no-underscore-dangle
  return find((element as HTMLElement & { __vue__?: Vue }).__vue__)
}
