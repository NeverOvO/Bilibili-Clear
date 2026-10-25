import exitHook from 'async-exit-hook'
import { randomBytes } from 'crypto'
import { Server } from 'http'
import { WebSocket, WebSocketServer } from 'ws'
import { Payload } from './payload'
import {
  buildFeature,
  getRegistryFeature,
  getFeatureSessionPaths,
  startFeatureSession,
  stopFeatureSession,
  stopFeatureSessionByPath,
} from './registry-watcher'
import { createFeature } from './scaffold'
import { devServerConfig } from './config'
import { isAuthenticatedSocket, parseClientPayload, sessionProtocol } from './security'

let server: WebSocketServer
const clients = new Map<string, WebSocket>()
const pendingDebugFeatureClients = new Map<
  string,
  {
    client: WebSocket
    payload: Extract<Payload, { type: 'startDebugFeature' }>
    lastError?: string
    timer: ReturnType<typeof setTimeout>
  }
>()

const createClientId = () => `dev-client-${randomBytes(4).toString('hex')}`

export const broadcastMessage = (message: Payload) => {
  if (!server) {
    return
  }
  const text = JSON.stringify(message)
  server.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text)
    }
  })
}
export const exitWebSocketServer = () => {
  if (!server) {
    return
  }
  broadcastMessage({ type: 'serverStop' })
  pendingDebugFeatureClients.forEach(pending => clearTimeout(pending.timer))
  pendingDebugFeatureClients.clear()
  server.clients.forEach(c => c.close())
}
const sendMessage = (client: WebSocket, payload: Payload) => {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload))
  }
}

const sendCommandResult = (
  client: WebSocket,
  payload: { requestId?: string },
  result: Omit<Extract<Payload, { type: 'commandResult' }>, 'type' | 'requestId'>,
) => {
  sendMessage(client, {
    type: 'commandResult',
    requestId: payload.requestId,
    featureSessions: getFeatureSessionPaths(),
    ...result,
  })
}

export const startWebSocketServer = (httpServer: Server) =>
  new Promise<void>(resolve => {
    server = new WebSocketServer({
      server: httpServer,
      maxPayload: 64 * 1024,
      perMessageDeflate: false,
      verifyClient: ({ req }) => req.url === '/' && isAuthenticatedSocket(req),
      handleProtocols: protocols => (protocols.has(sessionProtocol) ? sessionProtocol : false),
    })
    server.on('connection', client => {
      const clientId = createClientId()
      clients.set(clientId, client)
      sendMessage(client, {
        type: 'serverReady',
        clientId,
        featureSessions: getFeatureSessionPaths(),
      })
      client.on('close', () => {
        clients.delete(clientId)
        pendingDebugFeatureClients.forEach((pending, requestId) => {
          if (pending.client === client) {
            clearTimeout(pending.timer)
            pendingDebugFeatureClients.delete(requestId)
          }
        })
      })
      client.on('error', error => console.warn('DevClient 连接错误:', error.message))
      client.on('message', async data => {
        let payload: Payload | undefined
        let requestId: string | undefined
        try {
          const input: unknown = JSON.parse(data.toString())
          if (input && typeof input === 'object' && 'requestId' in input) {
            if (typeof input.requestId === 'string' && input.requestId.length <= 128) {
              requestId = input.requestId
            }
          }
          payload = parseClientPayload(input)
          console.log('收到 DevClient 命令:', payload.type)
          switch (payload.type) {
            default: {
              break
            }
            case 'startFeatureSession': {
              await startFeatureSession(payload.kind, payload.id)
              sendCommandResult(client, payload, {
                ok: true,
                message: `功能监听已启动: ${payload.kind}/${payload.id}`,
              })
              break
            }
            case 'stopFeatureSession': {
              if (!payload.path && (!payload.kind || !payload.id)) {
                throw new Error('stopFeatureSession 需要 path 或 kind + id')
              }
              const stopped = payload.path
                ? await stopFeatureSessionByPath(payload.path)
                : await stopFeatureSession(payload.kind, payload.id)
              sendCommandResult(client, payload, {
                ok: true,
                message: stopped ? '功能监听已停止' : '功能监听未运行',
              })
              break
            }
            case 'buildFeature': {
              await buildFeature(payload.kind, payload.id, payload.mode)
              sendCommandResult(client, payload, {
                ok: true,
                message: `功能已编译: ${payload.kind}/${payload.id}`,
              })
              break
            }
            case 'startDebugFeature': {
              const debugPayload = payload
              await startFeatureSession(debugPayload.kind, debugPayload.id)
              const feature = getRegistryFeature(debugPayload.kind, debugPayload.id)
              const { requestId } = debugPayload
              const targetClient = debugPayload.targetClientId
                ? clients.get(debugPayload.targetClientId)
                : undefined
              if (debugPayload.targetClientId && !targetClient) {
                throw new Error(`未找到 DevClient: ${debugPayload.targetClientId}`)
              }
              if (requestId) {
                const timer = setTimeout(() => {
                  const pending = pendingDebugFeatureClients.get(requestId)
                  if (!pending) {
                    return
                  }
                  pendingDebugFeatureClients.delete(requestId)
                  sendCommandResult(pending.client, pending.payload, {
                    ok: false,
                    error:
                      pending.lastError ??
                      `没有收到 DevClient 调试安装响应: ${debugPayload.kind}/${debugPayload.id}`,
                  })
                }, 15000)
                pendingDebugFeatureClients.set(requestId, {
                  client,
                  payload: debugPayload,
                  timer,
                })
              }
              const startDebugPayload: Payload = {
                type: 'startDebugFeature',
                kind: feature.kind,
                id: feature.id,
                path: feature.path,
                url: `http://127.0.0.1:${devServerConfig.port}${feature.path}`,
                requestId,
              }
              if (targetClient) {
                sendMessage(targetClient, startDebugPayload)
              } else {
                broadcastMessage(startDebugPayload)
              }
              break
            }
            case 'startDebugFeatureResult': {
              if (!payload.requestId) {
                break
              }
              const pending = pendingDebugFeatureClients.get(payload.requestId)
              if (!pending) {
                break
              }
              if (!payload.ok) {
                pending.lastError = payload.error
                break
              }
              clearTimeout(pending.timer)
              pendingDebugFeatureClients.delete(payload.requestId)
              sendCommandResult(pending.client, pending.payload, {
                ok: true,
                message: payload.message,
              })
              break
            }
            case 'createFeature': {
              const directory = createFeature(payload)
              sendCommandResult(client, payload, {
                ok: true,
                message: `功能已创建: ${directory}`,
              })
              break
            }
            case 'queryFeatureSessions': {
              sendMessage(client, {
                type: 'queryFeatureSessionsResponse',
                featureSessions: getFeatureSessionPaths(),
              })
              break
            }
            case 'shutdownServer': {
              sendCommandResult(client, payload, {
                ok: true,
                message: 'DevServer 正在退出',
              })
              setImmediate(() => process.emit('SIGTERM'))
              break
            }
          }
        } catch (error) {
          console.error('无效 DevClient 命令:', (error as Error).message)
          if (requestId) {
            sendCommandResult(client, { requestId }, {
              ok: false,
              error: (error as Error).message,
            })
          }
        }
      })
    })
    server.on('error', error => console.error(error))
    exitHook(exit =>
      server.close(error => {
        if (error) {
          console.error(error)
        }
        exit()
      }),
    )
    resolve()
  })
