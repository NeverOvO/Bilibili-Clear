import { randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, realpathSync } from 'fs'
import type { IncomingMessage } from 'http'
import path from 'path'
import type { FeatureKind, Payload } from './payload'

export const sessionHeader = 'x-bilibili-clear-dev-client'
export const sessionProtocol = 'bilibili-clear-dev'
// Kept in this server process only. A restart invalidates every prior session token.
export const sessionToken = randomBytes(32).toString('hex')

export const isLocalRequest = (request: IncomingMessage) => {
  if (!/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(request.headers.host ?? '')) {
    return false
  }
  try {
    const host = new URL(`http://${request.headers.host}`).hostname
    return host === '127.0.0.1' || host === 'localhost'
  } catch {
    return false
  }
}

export const isAllowedOrigin = (origin?: string) => {
  if (origin === undefined) {
    return true // Node CLI and privileged userscript requests do not send Origin.
  }
  try {
    const parsed = new URL(origin)
    if (parsed.origin !== origin) {
      return false
    }
    return (
      (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)) ||
      (parsed.protocol === 'https:' &&
        (parsed.hostname === 'bilibili.com' || parsed.hostname.endsWith('.bilibili.com')))
    )
  } catch {
    return false
  }
}

export const isAuthenticatedSocket = (request: IncomingMessage) => {
  if (!isLocalRequest(request) || !isAllowedOrigin(request.headers.origin)) {
    return false
  }
  const protocols = (request.headers['sec-websocket-protocol'] ?? '').split(/,\s*/)
  const token = protocols.find(protocol => protocol.startsWith('token.'))?.slice(6)
  if (!protocols.includes(sessionProtocol) || !token || !/^[a-f0-9]{64}$/.test(token)) {
    return false
  }
  return timingSafeEqual(
    new Uint8Array(Buffer.from(token)),
    new Uint8Array(Buffer.from(sessionToken)),
  )
}

const isInside = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export const getSafeFeatureDirectory = (kind: unknown, id: unknown) => {
  if (kind !== 'component' && kind !== 'plugin') {
    throw new Error('功能类型必须为 component 或 plugin')
  }
  if (typeof id !== 'string' || id.length > 240 || !/^[\w-]+(?:\/[\w-]+)*$/.test(id)) {
    throw new Error('功能 ID 只能包含字母、数字、下划线、短横线和目录分隔符')
  }
  const root = path.resolve(`registry/lib/${kind}s`)
  const directory = path.resolve(root, id)
  if (!isInside(root, directory)) {
    throw new Error('功能路径超出源码目录')
  }
  // Existing symlinks must not redirect creation or compilation outside the feature root.
  let ancestor = directory
  while (!existsSync(ancestor) && ancestor !== root) {
    ancestor = path.dirname(ancestor)
  }
  if (!isInside(realpathSync(root), realpathSync(ancestor))) {
    throw new Error('功能路径不能通过符号链接访问源码目录之外的位置')
  }
  return { kind: kind as FeatureKind, id, directory }
}

const assertText = (value: unknown, field: string, max = 256, required = false) => {
  if (value === undefined && !required) {
    return
  }
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`无效字段: ${field}`)
  }
}

export const parseClientPayload = (input: unknown): Payload => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('消息必须是对象')
  }
  const payload = input as Record<string, unknown>
  assertText(payload.requestId, 'requestId', 128)
  const hasFeature = () => getSafeFeatureDirectory(payload.kind, payload.id)
  switch (payload.type) {
    case 'queryFeatureSessions':
    case 'shutdownServer':
      break
    case 'startFeatureSession':
      hasFeature()
      break
    case 'buildFeature':
      hasFeature()
      if (
        payload.mode !== undefined &&
        payload.mode !== 'development' &&
        payload.mode !== 'production'
      ) {
        throw new Error('无效构建模式')
      }
      break
    case 'startDebugFeature':
      hasFeature()
      assertText(payload.targetClientId, 'targetClientId', 128)
      break
    case 'stopFeatureSession': {
      if (payload.path === undefined) {
        hasFeature()
        break
      }
      assertText(payload.path, 'path', 300, true)
      const match = (payload.path as string).match(
        /^\/registry\/dist\/(component|plugin)s\/(.+)\.js$/,
      )
      if (!match) {
        throw new Error('无效功能输出路径')
      }
      getSafeFeatureDirectory(match[1], match[2])
      break
    }
    case 'startDebugFeatureResult':
      if (typeof payload.ok !== 'boolean') {
        throw new Error('调试响应必须包含布尔值 ok')
      }
      assertText(payload.message, 'message', 4096)
      assertText(payload.error, 'error', 4096)
      break
    case 'createFeature':
      hasFeature()
      assertText(payload.name, 'name', 160)
      assertText(payload.displayName, 'displayName', 160, true)
      assertText(payload.authorName, 'authorName', 160, true)
      assertText(payload.authorLink, 'authorLink', 2048)
      assertText(payload.description, 'description', 16_384, true)
      break
    default:
      throw new Error('不支持的客户端命令')
  }
  return payload as unknown as Payload
}
