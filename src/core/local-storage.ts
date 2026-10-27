import { select } from './spin-query'
import { createPostHook, deleteValue, getRandomId } from './utils'

interface CrossOriginMessage {
  type: string
  id?: string
  key?: string
  value?: unknown
}
interface CrossOriginMessageListener {
  id: string
  resolve: (result: unknown) => void
  source: Window | null
}
interface CrossOriginStorageListener {
  id: string
  callback: (newValue: string) => void
  source: Window | null
}

const storageOrigin = 'https://s1.hdslb.com'
const storageFrameSelector =
  'iframe[src^="https://s1.hdslb.com/bfs/seed/jinkela/short/cols/iframe.html"][data-loaded="true"]'
const requestTimeout = 15000
const postMessage = async (
  message: CrossOriginMessage,
  beforeSend: (source: Window) => boolean = () => true,
) => {
  const iframe = (await select(storageFrameSelector)) as HTMLIFrameElement | null
  if (!iframe?.contentWindow) {
    throw new Error('COLS iframe not found')
  }
  if (beforeSend(iframe.contentWindow)) {
    iframe.contentWindow.postMessage(message, storageOrigin)
  }
}
const messageListeners: CrossOriginMessageListener[] = []
const storageListeners: CrossOriginStorageListener[] = []
window.addEventListener('message', e => {
  if (
    e.origin === storageOrigin &&
    e.data !== null &&
    typeof e.data === 'object' &&
    e.data.type === 'COLS_RES' &&
    typeof e.data.id === 'string'
  ) {
    const data = e.data as CrossOriginMessage
    const { id } = data
    const handleMessageListeners = () => {
      const listenerIndex = messageListeners.findIndex(
        it => it.id === id && it.source === e.source && it.source !== null,
      )
      if (listenerIndex < 0) {
        return
      }
      const [listener] = messageListeners.splice(listenerIndex, 1)
      listener.resolve(data.value)
    }
    const handleStorageListeners = () => {
      const index = storageListeners.findIndex(
        it => it.id === id && it.source === e.source && it.source !== null,
      )
      if (index < 0) {
        return
      }
      storageListeners[index].callback(data.value as string)
    }
    handleMessageListeners()
    handleStorageListeners()
  }
})

const requestStorage = <Result = void>(message: CrossOriginMessage) =>
  new Promise<Result>((resolve, reject) => {
    const id = getRandomId(32)
    const removeListener = () => deleteValue(messageListeners, item => item.id === id)
    const timer = setTimeout(() => {
      removeListener()
      reject(new Error('COLS request timed out'))
    }, requestTimeout)
    const listener: CrossOriginMessageListener = {
      id,
      source: null,
      resolve: value => {
        clearTimeout(timer)
        resolve(value as Result)
      },
    }
    messageListeners.push(listener)
    postMessage({ ...message, id }, source => {
      if (!messageListeners.includes(listener)) {
        return false
      }
      listener.source = source
      return true
    }).catch(error => {
      clearTimeout(timer)
      removeListener()
      reject(error)
    })
  })
/** 跨域 Local Storage (由 b 站官方提供) */
export const crossOriginLocalStorage = {
  setItem: (key: string, item: unknown) => requestStorage({ type: 'COLS_SET', key, value: item }),
  getItem: <Result = string>(key: string) => requestStorage<Result>({ type: 'COLS_GET', key }),
  removeItem: (key: string) => requestStorage({ type: 'COLS_RM', key }),
  keys: (prefix: string) => requestStorage<string[]>({ type: 'COLS_KEYS', key: prefix }),
  clear: (prefix: string) => requestStorage({ type: 'COLS_CLR', key: prefix }),
  addStorageListener: async (key: string, callback: CrossOriginStorageListener['callback']) => {
    const callbackId = getRandomId(32)
    const listener: CrossOriginStorageListener = { id: callbackId, callback, source: null }
    storageListeners.push(listener)
    let timer: ReturnType<typeof setTimeout>
    try {
      await Promise.race([
        postMessage({ type: 'COLS_LIS', key, id: callbackId }, source => {
          if (!storageListeners.includes(listener)) {
            return false
          }
          listener.source = source
          return true
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('COLS listener registration timed out')),
            requestTimeout,
          )
        }),
      ])
      return callbackId
    } catch (error) {
      deleteValue(storageListeners, item => item === listener)
      throw error
    } finally {
      clearTimeout(timer)
    }
  },
  removeStorageListener: async (key: string, callbackId: string) => {
    deleteValue(storageListeners, it => it.id === callbackId)
    await postMessage({ type: 'COLS_LIS_UN', key, id: callbackId })
  },
}

type LocalStorageListener = (key: string, value: string) => void
const localStorageListeners: LocalStorageListener[] = []
let currentWindowLocalStorageHooked = false

/**
 * 添加对 LocalStorage 的变化监听, 支持当前 window 和同源的其他 window 产生的 LocalStorage 变化
 * @param onLocalStorageUpdate LocalStorage 变化回调
 * @returns 取消监听的函数
 */
export const watchLocalStorage = (onLocalStorageUpdate: LocalStorageListener) => {
  if (!currentWindowLocalStorageHooked) {
    createPostHook(unsafeWindow.localStorage, 'setItem', (key: string, value: string) => {
      localStorageListeners.forEach(listener => listener(key, value))
    })
    currentWindowLocalStorageHooked = true
  }
  localStorageListeners.push(onLocalStorageUpdate)
  const otherWindowLocalStorageListener = (e: StorageEvent) => {
    onLocalStorageUpdate(e.key, e.newValue)
  }
  window.addEventListener('storage', otherWindowLocalStorageListener)
  return () => {
    const index = localStorageListeners.indexOf(onLocalStorageUpdate)
    if (index > -1) {
      localStorageListeners.splice(index, 1)
    }
    window.removeEventListener('storage', otherWindowLocalStorageListener)
  }
}
