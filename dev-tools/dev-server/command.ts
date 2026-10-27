import { WebSocket } from 'ws'
import { devServerConfig } from './config'
import { Payload, FeatureKind } from './payload'

const [, , command, kindText, ...args] = process.argv

const usage = () => {
  console.log(`Usage:
pnpm tsx dev-tools/dev-server/command.ts build <component|plugin> <id> [development|production]
pnpm tsx dev-tools/dev-server/command.ts watch <component|plugin> <id>
pnpm tsx dev-tools/dev-server/command.ts stop <component|plugin> <id>
pnpm tsx dev-tools/dev-server/command.ts start-debug <component|plugin> <id> [targetClientId]
pnpm tsx dev-tools/dev-server/command.ts stop-debug <component|plugin> <id>
pnpm tsx dev-tools/dev-server/command.ts sessions
pnpm tsx dev-tools/dev-server/command.ts shutdown
pnpm tsx dev-tools/dev-server/command.ts create <component|plugin> <id> <name> <displayName> <authorName> [authorLink] [description]`)
}

const isFeatureKind = (value: string): value is FeatureKind =>
  value === 'component' || value === 'plugin'

const createRequestId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const createPayload = (): Payload => {
  if (command === 'sessions') {
    return { type: 'queryFeatureSessions' }
  }
  if (command === 'shutdown') {
    return { type: 'shutdownServer', requestId: createRequestId() }
  }
  if (!isFeatureKind(kindText)) {
    usage()
    throw new Error(`无效功能类型: ${kindText}`)
  }
  const [id, modeOrName, displayName, authorName, authorLink = '', description = ''] = args
  if (!id) {
    usage()
    throw new Error('缺少功能 ID')
  }
  const requestId = createRequestId()
  if (command === 'build') {
    return {
      type: 'buildFeature',
      kind: kindText,
      id,
      mode: modeOrName === 'production' ? 'production' : 'development',
      requestId,
    }
  }
  if (command === 'watch') {
    return {
      type: 'startFeatureSession',
      kind: kindText,
      id,
      requestId,
    }
  }
  if (command === 'stop') {
    return {
      type: 'stopFeatureSession',
      kind: kindText,
      id,
      requestId,
    }
  }
  if (command === 'start-debug') {
    return {
      type: 'startDebugFeature',
      kind: kindText,
      id,
      targetClientId: modeOrName,
      requestId,
    }
  }
  if (command === 'stop-debug') {
    return {
      type: 'stopFeatureSession',
      kind: kindText,
      id,
      requestId,
    }
  }
  if (command === 'create') {
    if (!modeOrName || !displayName || !authorName) {
      usage()
      throw new Error('create 需要 id、name、displayName 和 authorName')
    }
    return {
      type: 'createFeature',
      kind: kindText,
      id,
      name: modeOrName,
      displayName,
      authorName,
      authorLink,
      description: description || displayName,
      requestId,
    }
  }
  usage()
  throw new Error(`无效命令: ${command}`)
}

const run = async () => {
  const payload = createPayload()
  const sessionResponse = await fetch(`http://127.0.0.1:${devServerConfig.port}/__dev/session`, {
    headers: { 'x-bilibili-clear-dev-client': '1' },
    signal: AbortSignal.timeout(5000),
  })
  if (!sessionResponse.ok) {
    throw new Error(`DevServer 会话请求失败: HTTP ${sessionResponse.status}`)
  }
  const session = (await sessionResponse.json()) as { token?: string }
  if (typeof session.token !== 'string' || !/^[a-f0-9]{64}$/.test(session.token)) {
    throw new Error('DevServer 返回了无效会话')
  }
  const socket = new WebSocket(`ws://127.0.0.1:${devServerConfig.port}`, [
    'bilibili-clear-dev',
    `token.${session.token}`,
  ])
  let receivedResult = false
  let failed = false
  let commandTimeout: ReturnType<typeof setTimeout>
  const fail = (message: string) => {
    if (failed) {
      return
    }
    failed = true
    clearTimeout(commandTimeout)
    console.error(message)
    process.exitCode = 1
    socket.terminate()
  }
  commandTimeout = setTimeout(() => fail('DevServer 命令响应超时'), 120_000)
  socket.once('close', () => {
    clearTimeout(commandTimeout)
    if (!receivedResult && !failed) {
      failed = true
      console.error('DevServer 连接已关闭，但未收到命令结果')
      process.exitCode = 1
    }
  })

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify(payload))
  })

  socket.addEventListener('message', event => {
    if (receivedResult || failed) {
      return
    }
    try {
      const response = JSON.parse(event.data.toString()) as Payload
      if (!response || typeof response !== 'object') {
        throw new Error('响应不是对象')
      }
      const isSessionList = (value: unknown): value is string[] =>
        Array.isArray(value) && value.every(item => typeof item === 'string')
      if (
        payload.type === 'queryFeatureSessions' &&
        response.type === 'queryFeatureSessionsResponse'
      ) {
        if (!isSessionList(response.featureSessions)) {
          throw new Error('会话列表格式无效')
        }
        receivedResult = true
        clearTimeout(commandTimeout)
        console.log(response.featureSessions.join('\n'))
        socket.close()
        return
      }
      if ('requestId' in payload && response.type === 'commandResult') {
        if (response.requestId !== payload.requestId) {
          return
        }
        if (typeof response.ok !== 'boolean') {
          throw new Error('命令状态格式无效')
        }
        if (response.message !== undefined && typeof response.message !== 'string') {
          throw new Error('命令说明格式无效')
        }
        if (response.featureSessions !== undefined && !isSessionList(response.featureSessions)) {
          throw new Error('会话列表格式无效')
        }
        receivedResult = true
        clearTimeout(commandTimeout)
        if (response.message) {
          console.log(
            command === 'stop-debug' ? response.message.replace('监听', '调试') : response.message,
          )
        }
        if (response.featureSessions) {
          console.log(`featureSessions: ${response.featureSessions.join(', ')}`)
        }
        if (!response.ok) {
          console.error(response.error || 'DevServer 命令执行失败')
          process.exitCode = 1
        }
        socket.close()
      }
    } catch (error) {
      fail(`DevServer 返回了无效响应: ${(error as Error).message}`)
    }
  })

  socket.addEventListener('error', () => {
    fail(`无法连接 DevServer: ws://127.0.0.1:${devServerConfig.port}`)
  })
}

run().catch(error => {
  console.error((error as Error).message)
  process.exitCode = 1
})
