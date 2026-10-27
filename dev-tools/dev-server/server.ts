import { createServer, Server } from 'http'
import { readFile, realpath } from 'fs/promises'
import path from 'path'
import exitHook from 'async-exit-hook'
import { devServerConfig } from './config'
import { exitWebSocketServer } from './web-socket-server'
import { isAllowedOrigin, isLocalRequest, sessionHeader, sessionToken } from './security'
import {
  featureSessions,
  parseRegistryUrl,
  readRegistryOutput,
  startFeatureSessionWatcher,
} from './registry-watcher'

export const startDevServer = () =>
  new Promise<Server>((resolve, reject) => {
    const { port } = devServerConfig
    const server = createServer(async (request, response) => {
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      const fail = (status: number, message: string) => {
        if (!response.writableEnded) {
          response.statusCode = status
          response.end(message)
        }
      }
      if (!isLocalRequest(request) || !isAllowedOrigin(request.headers.origin)) {
        fail(403, 'Forbidden')
        return
      }
      // No CORS access: browser pages cannot read the session endpoint or request
      // it with the custom header. CLI and privileged GM requests can do both.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        fail(405, 'Method not allowed')
        return
      }
      response.setTimeout(60_000, () => fail(504, 'Build request timed out'))
      try {
        const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (pathname === '/__dev/session') {
          if (request.headers[sessionHeader] !== '1' || request.method !== 'GET') {
            fail(403, 'Privileged dev client required')
            return
          }
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ token: sessionToken }))
          return
        }
        console.log('请求:', pathname)
        if (pathname.startsWith('/registry/')) {
          const feature = parseRegistryUrl(pathname)
          if (!feature) {
            fail(404, 'Not found')
            return
          }
          const existingSession = featureSessions.find(s => s.path === feature.path)
          if (!existingSession || !readRegistryOutput(feature.path)) {
            await startFeatureSessionWatcher(feature)
          }
          if (response.writableEnded) {
            return
          }
          const output = readRegistryOutput(feature.path)
          if (!output) {
            fail(404, 'Build output not available')
            return
          }
          response.setHeader('Content-Type', 'application/javascript; charset=utf-8')
          response.end(request.method === 'HEAD' ? undefined : output)
          return
        }
        // Serve userscript outputs only, never files from the repository root.
        if (!/^\/dist\/[\w.-]+\.user\.js(?:\.map)?$/.test(pathname)) {
          fail(404, 'Not found')
          return
        }
        const root = await realpath(path.resolve('dist'))
        const file = await realpath(path.resolve(`.${pathname}`))
        const relative = path.relative(root, file)
        if (
          relative.startsWith(`..${path.sep}`) ||
          relative === '..' ||
          path.isAbsolute(relative)
        ) {
          fail(403, 'Forbidden')
          return
        }
        const contents = await readFile(file)
        response.setHeader(
          'Content-Type',
          pathname.endsWith('.map') ? 'application/json' : 'application/javascript; charset=utf-8',
        )
        response.end(request.method === 'HEAD' ? undefined : contents)
      } catch (error) {
        console.error('DevServer 请求失败:', (error as Error).message)
        fail(404, 'Requested output is unavailable')
      }
    })
    server.once('error', reject)
    exitHook(exit => {
      exitWebSocketServer()
      server.close(error => {
        if (error) {
          console.error(error)
        }
        console.log('DevServer 已退出')
        exit()
      })
    })
    server.listen(port, '127.0.0.1', () => {
      console.log(`DevServer 已启动: http://127.0.0.1:${port}`)
      resolve(server)
    })
  })
