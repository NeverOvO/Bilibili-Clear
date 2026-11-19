import { addComponentListener, removeComponentListener } from '../settings'
import { deleteValue, getRandomId } from '../utils'
import { ShadowDomEntry } from './dom-entry'
import { ShadowDomObserver, shadowDomObserver } from './dom-observer'

export interface ShadowRootStyleEntry {
  id: string
  styleSheet: CSSStyleSheet
  adoptedShadowDoms: ShadowDomEntry[]
  remove: () => void
}
export interface ShadowRootStyleDefinition {
  id?: string
  style: string
}
export class ShadowRootStyles {
  observer: ShadowDomObserver = shadowDomObserver
  protected stylesMap = new Map<string, ShadowRootStyleEntry>()
  private pendingSheets = new Map<string, CSSStyleSheet>()

  protected addEntry(id: string, entry: ShadowRootStyleEntry) {
    this.stylesMap.set(id, entry)
  }

  protected removeEntry(id: string) {
    if (this.stylesMap.has(id)) {
      this.stylesMap.delete(id)
    }
  }

  async addStyle(definition: ShadowRootStyleDefinition) {
    const { id, style } = definition
    const entryId = id !== undefined ? lodash.kebabCase(id) : `shadow-dom-style-${getRandomId()}`
    const styleSheet = new CSSStyleSheet()
    const adoptedShadowDoms: ShadowDomEntry[] = []
    let unwatch: (() => void) | undefined
    const entry: ShadowRootStyleEntry = {
      id: entryId,
      styleSheet,
      adoptedShadowDoms,
      remove: () => {
        unwatch?.()
        unwatch = undefined
        adoptedShadowDoms.forEach(it =>
          deleteValue(it.shadowRoot.adoptedStyleSheets, sheet => sheet === styleSheet),
        )
        adoptedShadowDoms.length = 0
        if (this.stylesMap.get(entryId) === entry) {
          this.removeEntry(entryId)
        }
      },
    }
    this.pendingSheets.set(entryId, styleSheet)
    try {
      await styleSheet.replace(style)
      if (this.pendingSheets.get(entryId) === styleSheet) {
        unwatch = this.observer.watchShadowDom({
          added: shadowDom => {
            if (!shadowDom.shadowRoot.adoptedStyleSheets.includes(styleSheet)) {
              shadowDom.shadowRoot.adoptedStyleSheets.push(styleSheet)
              adoptedShadowDoms.push(shadowDom)
            }
          },
          removed: shadowDom => {
            deleteValue(shadowDom.shadowRoot.adoptedStyleSheets, sheet => sheet === styleSheet)
            deleteValue(adoptedShadowDoms, item => item === shadowDom)
          },
        })
        if (this.pendingSheets.get(entryId) === styleSheet) {
          this.stylesMap.get(entryId)?.remove()
          this.addEntry(entryId, entry)
        } else {
          entry.remove()
        }
      }
      return entry
    } catch (error) {
      entry.remove()
      throw error
    } finally {
      if (this.pendingSheets.get(entryId) === styleSheet) {
        this.pendingSheets.delete(entryId)
      }
    }
  }

  removeStyle(id: string) {
    const entryId = lodash.kebabCase(id)
    this.pendingSheets.delete(entryId)
    this.stylesMap.get(entryId)?.remove()
  }

  toggleWithComponent(path: string, definition: ShadowRootStyleDefinition) {
    const id = definition.id ?? `shadow-dom-style-${getRandomId()}`
    const handler = (enabled: unknown) => {
      if (enabled) {
        this.addStyle({ ...definition, id }).catch(error => {
          console.error('加载 Shadow DOM 样式失败。', id, error)
        })
      } else {
        this.removeStyle(id)
      }
    }
    addComponentListener(path, handler, true)
    return () => removeComponentListener(path, handler)
  }
}

export const shadowRootStyles = new ShadowRootStyles()
