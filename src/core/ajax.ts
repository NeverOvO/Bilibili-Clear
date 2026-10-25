import { logError } from './utils/log'

type XhrBody = Document | XMLHttpRequestBodyInit
type XhrConfig = (xhr: XMLHttpRequest) => { isText?: boolean; body?: XhrBody }
const defaultTimeout = (responseType?: string) =>
  responseType === 'blob' || responseType === 'arraybuffer' ? 10 * 60_000 : 60_000
const isSuccessStatus = (status: number) => status >= 200 && status < 300
const requestError = (reason: string, url: string, status = 0) => {
  // Query strings can contain user data or access credentials.
  let source = ''
  try {
    if (!url) {
      throw new Error('Unknown request URL')
    }
    const parsed = new URL(url, window.location.href)
    source = `${parsed.origin}${parsed.pathname}`
  } catch {
    source = 'unknown URL'
  }
  return Object.assign(new Error(`${reason}${status ? ` (HTTP ${status})` : ''}: ${source}`), {
    name: 'RequestError',
    status,
    url: source,
  })
}
const send = <T = any>(config: XhrConfig) => {
  const xhr = new XMLHttpRequest()
  const { isText = true, body } = config(xhr)
  return new Promise<T>((resolve, reject) => {
    xhr.timeout = defaultTimeout(xhr.responseType)
    xhr.addEventListener('load', () => {
      if (!isSuccessStatus(xhr.status)) {
        reject(requestError('Request failed', xhr.responseURL, xhr.status))
        return
      }
      resolve(isText ? xhr.responseText : xhr.response)
    })
    xhr.addEventListener('error', () =>
      reject(requestError('Network error', xhr.responseURL, xhr.status)),
    )
    xhr.addEventListener('timeout', () => reject(requestError('Request timed out', xhr.responseURL)))
    xhr.addEventListener('abort', () => reject(requestError('Request aborted', xhr.responseURL)))
    xhr.send(body)
  })
}
const withCredentials = (config: XhrConfig) => (xhr: XMLHttpRequest) => {
  xhr.withCredentials = true
  return config(xhr)
}

// GET
const blobRequest =
  (url: string): XhrConfig =>
  (xhr: XMLHttpRequest) => {
    xhr.responseType = 'blob'
    xhr.open('GET', url)
    return {
      isText: false,
    }
  }
/**
 * 获取二进制`Blob`对象
 * @param url 链接
 */
export const getBlob = (url: string) => send<Blob>(blobRequest(url))
/**
 * 获取二进制`Blob`对象(带身份验证)
 * @param url 链接
 */
export const getBlobWithCredentials = (url: string) => send<Blob>(withCredentials(blobRequest(url)))

const textRequest =
  (url: string): XhrConfig =>
  (xhr: XMLHttpRequest) => {
    xhr.responseType = 'text'
    xhr.open('GET', url)
    return {
      isText: true,
    }
  }
/**
 * 获取文本
 * @param url 链接
 */
export const getText = (url: string) => send<string>(textRequest(url))

/**
 * 获取文本(带身份验证)
 * @param url 链接
 */
export const getTextWithCredentials = (url: string) =>
  send<string>(withCredentials(textRequest(url)))

const jsonRequest =
  (url: string): XhrConfig =>
  (xhr: XMLHttpRequest) => {
    xhr.responseType = 'json'
    xhr.open('GET', url)
    return {
      isText: false,
    }
  }
const convertToJson = <T = any>(response: any) => {
  if (typeof response === 'string') {
    return JSON.parse(response) as T
  }
  return response as T
}
/**
 * 获取 JSON 对象
 * @param url 链接
 */
export const getJson = async <T = any>(url: string) => {
  const response = await send(jsonRequest(url))
  return convertToJson<T>(response)
}
/**
 * 获取 JSON 对象(带身份验证)
 * @param url 链接
 */
export const getJsonWithCredentials = async <T = any>(url: string) => {
  const response = await send(withCredentials(jsonRequest(url)))
  return convertToJson<T>(response)
}

// POST
/**
 * 发送文本 (`application/x-www-form-urlencoded`)
 * @param url 链接
 * @param text 文本
 */
export const postText = (url: string, text: XhrBody) =>
  send<string>(xhr => {
    xhr.open('POST', url)
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded')
    return {
      isText: false,
      body: text,
    }
  })
/**
 * 发送文本 (`application/x-www-form-urlencoded`)(带身份验证)
 * @param url 链接
 * @param text 文本
 */
export const postTextWithCredentials = (url: string, text: XhrBody) =>
  send<string>(xhr => {
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded')
    return {
      isText: false,
      body: text,
    }
  })
/**
 * 发送 JSON 数据 (`application/json`)
 * @param url 链接
 * @param json JSON 对象
 */
export const postJson = (url: string, json: any) =>
  send<string>(xhr => {
    xhr.open('POST', url)
    xhr.setRequestHeader('Content-Type', 'application/json')
    return {
      isText: false,
      body: JSON.stringify(json),
    }
  })
/**
 * 发送 JSON 数据 (`application/json`)(带身份验证)
 * @param url 链接
 * @param json JSON 对象
 */
export const postJsonWithCredentials = (url: string, json: any) =>
  send<string>(xhr => {
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', 'application/json')
    return {
      isText: false,
      body: JSON.stringify(json),
    }
  })

/**
 * 调用 Tampermonkey API 进行请求 (`GM_xmlhttpRequest`)
 * @param details 参数
 */
export const monkey = <T = any>(details: MonkeyXhrBasicDetails) =>
  new Promise<T>((resolve, reject) => {
    const fullDetails: MonkeyXhrDetails = {
      nocache: true,
      ...details,
      timeout: details.timeout ?? defaultTimeout(details.responseType),
      onload: (r: MonkeyXhrResponse) => {
        if (!isSuccessStatus(r.status)) {
          reject(requestError('Request failed', details.url, r.status))
          return
        }
        resolve(r.response)
      },
      onerror: (r: MonkeyXhrResponse) =>
        reject(requestError('Network error', details.url, r?.status)),
      ontimeout: () => reject(requestError('Request timed out', details.url)),
      onabort: () => reject(requestError('Request aborted', details.url)),
    }
    if (!('method' in fullDetails)) {
      fullDetails.method = 'GET'
    }
    GM_xmlhttpRequest(fullDetails)
  })
/**
 * 获取全部的分页数据, 返回一个会随翻页变化的数组, 可用于响应式数据
 * @param config 配置参数
 */
export const responsiveGetPages = <T = any>(config: {
  /** API 地址, 可接受`page`参数表示页码 */
  api: (page: number) => Promise<any>
  /** 从返回的对象中获取本页的数据 */
  getList: (json: any) => T[]
  /** 从返回的对象中获取数据总数 */
  getTotal: (json: any) => number
}): [Promise<T[]>, Promise<T[]>] => {
  const { api, getList, getTotal } = config
  const firstResponse = Promise.resolve().then(() => api(1))
  const readPage = (json: any, page: number) => {
    if (typeof json?.code === 'number' && json.code !== 0) {
      throw new Error(`API request failed on page ${page}: ${json.message ?? json.code}`)
    }
    const list = getList(json)
    if (!Array.isArray(list)) {
      throw new Error(`Invalid page data on page ${page}`)
    }
    return list
  }
  const responsivePromise = firstResponse.then(json => [...readPage(json, 1)])
  const totalPromise = responsivePromise.then(async result => {
    const total = getTotal(await firstResponse)
    if (!Number.isFinite(total) || total < 0) {
      throw new Error('Invalid pagination total')
    }
    const pageSize = result.length || 1
    const totalPages = Math.ceil(total / pageSize)
    // Keep the first-page array reactive while loading at most five pages at once.
    const batchSize = 5
    for (let page = 2; page <= totalPages; page += batchSize) {
      const pageNumbers = Array.from(
        { length: Math.min(batchSize, totalPages - page + 1) },
        (_, index) => page + index,
      )
      const lists = await Promise.all(
        pageNumbers.map(async pageNumber => readPage(await api(pageNumber), pageNumber)),
      )
      result.push(...lists.flat())
    }
    return result
  })
  // Some consumers only use the first-page promise. Keep background failures
  // visible without leaving an unhandled rejection; awaiting total still rejects.
  totalPromise.catch(error => console.warn('[分页请求] 获取失败:', error))
  return [responsivePromise, totalPromise]
}
/**
 * 获取全部的分页数据
 * @param config 配置参数
 */
export const getPages = async <T = any>(config: {
  /** API 地址, 可接受`page`参数表示页码 */
  api: (page: number) => Promise<any>
  /** 从返回的对象中获取本页的数据 */
  getList: (json: any) => T[]
  /** 从返回的对象中获取数据总数 */
  getTotal: (json: any) => number
}) => {
  const [, total] = responsiveGetPages(config)
  const result = await total
  return result
}

/** bilibili API 标准响应 */
export interface BilibiliApiResponse {
  code: number
  message: string
  msg?: string
  ttl: number
  data: any
  result?: any
}

/**
 * 进行 bilibili API 标准响应处理
 * @param apiPromise 运行中的 API Promise
 * @param errorMessage 出错时的提示信息
 * @param log 是否输出错误信息
 */
export const bilibiliApi = async <T = any>(
  apiPromise: Promise<BilibiliApiResponse>,
  errorMessage?: string,
  log = true,
) => {
  const json = await apiPromise
  if (json.code !== 0) {
    const error = new Error(
      `${errorMessage}: code = ${json.code}, message = ${json.message || json.msg}`,
    )
    if (log) {
      logError(error)
    }
    throw error
  }
  return (json.data || json.result || {}) as T
}
