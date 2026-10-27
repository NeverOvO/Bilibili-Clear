import { getUID } from '@/core/utils'

export interface MessageUnreadSnapshot {
  accountId: string
  /** The badge count; zero when the account has disabled message notifications. */
  count: number
  notificationsEnabled: boolean
}

export type MessageUnreadErrorKind =
  | 'login'
  | 'account-changed'
  | 'aborted'
  | 'timeout'
  | 'network'
  | 'api'
  | 'format'

export class MessageUnreadError extends Error {
  constructor(
    message: string,
    public readonly kind: MessageUnreadErrorKind,
    public readonly code?: number,
  ) {
    super(message)
    this.name = kind === 'aborted' ? 'AbortError' : 'MessageUnreadError'
  }
}

type ApiObject = Record<string, unknown>
const isObject = (value: unknown): value is ApiObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const formatError = () => new MessageUnreadError('消息未读数据格式已变化，请打开原版消息页查看。', 'format')
const abortError = () => new MessageUnreadError('读取消息未读数量已取消。', 'aborted')
const requireAccount = (expected?: string) => {
  const accountId = getUID() || ''
  if (expected && accountId !== expected) {
    throw new MessageUnreadError('登录账号已变化，请刷新消息数量。', 'account-changed')
  }
  if (!/^[1-9]\d*$/.test(accountId)) {
    throw new MessageUnreadError('请先登录 B 站后查看消息。', 'login')
  }
  return accountId
}
const integer = (value: unknown): number => {
  // Do not coerce null, an absent field, or an empty string into a successful zero.
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw formatError()
  }
  return parsed
}

/** Read-only snapshot using the same badge semantics as custom-navbar/messages. */
export const fetchMessageUnread = async (
  signal?: AbortSignal,
): Promise<MessageUnreadSnapshot> => {
  if (signal?.aborted) { throw abortError() }
  const accountId = requireAccount()
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let timedOut = false
  // One deadline covers settings and both unread endpoints, rather than 12 seconds each.
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 12_000)
  const assertCurrent = () => {
    if (controller.signal.aborted) { throw abortError() }
    requireAccount(accountId)
  }
  const request = async (path: string): Promise<ApiObject> => {
    assertCurrent()
    const response = await fetch(`https://api.vc.bilibili.com/${path}`, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    assertCurrent()
    if (!response.ok) {
      throw new MessageUnreadError(`消息请求失败（HTTP ${response.status}），请稍后重试。`, 'network')
    }
    let json: unknown
    try {
      json = await response.json()
    } catch {
      assertCurrent()
      throw formatError()
    }
    assertCurrent()
    if (!isObject(json) || typeof json.code !== 'number' || !Number.isSafeInteger(json.code)) {
      throw formatError()
    }
    if (json.code === -101) {
      throw new MessageUnreadError('登录凭据已失效，请重新登录 B 站。', 'login', json.code)
    }
    if (json.code !== 0) {
      throw new MessageUnreadError(`消息数量暂时无法读取（${json.code}），请稍后重试。`, 'api', json.code)
    }
    if (!isObject(json.data)) { throw formatError() }
    return json.data
  }

  try {
    const settings = await request('link_setting/v1/link_setting/get?msg_notify=1&show_unfollowed_msg=1')
    const notificationsEnabled = integer(settings.msg_notify) !== 3
    if (!notificationsEnabled) {
      assertCurrent()
      return { accountId, count: 0, notificationsEnabled }
    }
    const hideNotFollowed = integer(settings.show_unfollowed_msg) === 1
    const [main, messages] = await Promise.all([
      request('x/im/web/msgfeed/unread'),
      request('session_svr/v1/session_svr/single_unread'),
    ])
    const counts = [main.reply, main.at, main.like, main.sys_msg, messages.follow_unread]
    if (!hideNotFollowed) { counts.push(messages.unfollow_unread) }
    const count = integer(counts.reduce<number>((sum, value) => sum + integer(value), 0))
    assertCurrent()
    return { accountId, count, notificationsEnabled }
  } catch (error) {
    if (signal?.aborted) { throw abortError() }
    if (timedOut) {
      throw new MessageUnreadError('读取消息数量超时，请稍后重试。', 'timeout')
    }
    requireAccount(accountId)
    if (error instanceof MessageUnreadError) { throw error }
    throw new MessageUnreadError('无法连接 B 站消息服务，请稍后重试。', 'network')
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.abort()
  }
}
