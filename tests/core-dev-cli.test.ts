import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const tick = () => new Promise(resolve => setImmediate(resolve))
const commandHarness = async (args = ['build', 'component', 'style/test']) => {
  const errors: string[] = []
  const logs: string[] = []
  const timers = new Map<number, () => void>()
  let sequence = 0
  const process = { argv: ['node', 'command.ts', ...args], exitCode: undefined as number }
  let socket: Socket
  class Socket {
    handlers = new Map<string, ((event: any) => void)[]>()
    sent: any[] = []
    terminated = false
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      socket = this
    }
    once(name: string, callback: (event: any) => void) {
      this.addEventListener(name, callback)
    }
    addEventListener(name: string, callback: (event: any) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), callback])
    }
    send(data: string) {
      this.sent.push(JSON.parse(data))
    }
    emit(name: string, data?: unknown) {
      this.handlers.get(name)?.forEach(callback => callback(data))
    }
    close() {
      this.emit('close')
    }
    terminate() {
      this.terminated = true
      this.close()
    }
  }
  const { outputText } = ts.transpileModule(
    readFileSync('dev-tools/dev-server/command.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  )
  vm.runInNewContext(outputText, {
    exports: {},
    process,
    console: {
      log: (value: string) => logs.push(value),
      error: (value: string) => errors.push(value),
    },
    AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ token: 'a'.repeat(64) }) }),
    require: (name: string) =>
      name === 'ws' ? { WebSocket: Socket } : { devServerConfig: { port: 2333 } },
    setTimeout: (callback: () => void) => {
      const id = ++sequence
      timers.set(id, callback)
      return id
    },
    clearTimeout: (id: number) => timers.delete(id),
  })
  await tick()
  socket.emit('open')
  return {
    socket,
    process,
    errors,
    logs,
    timers,
    reply: (payload: unknown) => socket.emit('message', { data: JSON.stringify(payload) }),
  }
}

test('CLI exits unsuccessfully when the server closes before a terminal response', async () => {
  const h = await commandHarness()
  h.reply({ type: 'serverReady', clientId: 'test', featureSessions: [] })
  h.socket.close()
  assert.equal(h.process.exitCode, 1)
  assert.equal(h.timers.size, 0)
  assert.match(h.errors[0], /未收到命令结果/)
})

test('CLI ignores a command result for another request and does not report success', async () => {
  const h = await commandHarness()
  h.reply({ type: 'commandResult', requestId: 'other', ok: true })
  assert.equal(h.timers.size, 1)
  h.socket.close()
  assert.equal(h.process.exitCode, 1)
})

test('CLI reports malformed JSON cleanly and terminates without leaking its timeout', async () => {
  const h = await commandHarness()
  h.socket.emit('message', { data: '{not json' })
  assert.equal(h.process.exitCode, 1)
  assert.equal(h.socket.terminated, true)
  assert.equal(h.timers.size, 0)
  assert.equal(h.errors.length, 1)
  assert.match(h.errors[0], /无效响应/)
})

test('CLI rejects malformed terminal status even with the correct request ID', async () => {
  const h = await commandHarness()
  h.reply({ type: 'commandResult', requestId: h.socket.sent[0].requestId, ok: 'true' })
  assert.equal(h.process.exitCode, 1)
  assert.equal(h.socket.terminated, true)
  assert.match(h.errors[0], /命令状态格式无效/)
})

test('CLI preserves an explicit command failure and closes the connection', async () => {
  const h = await commandHarness()
  h.reply({
    type: 'commandResult',
    requestId: h.socket.sent[0].requestId,
    ok: false,
    error: 'build failed',
  })
  assert.equal(h.process.exitCode, 1)
  assert.equal(h.timers.size, 0)
  assert.deepEqual(h.errors, ['build failed'])
})

test('CLI shutdown succeeds only after its matching confirmation, then tolerates server close', async () => {
  const h = await commandHarness(['shutdown'])
  h.reply({
    type: 'commandResult',
    requestId: h.socket.sent[0].requestId,
    ok: true,
    message: 'stopping',
  })
  h.socket.close()
  assert.equal(h.process.exitCode, undefined)
  assert.equal(h.timers.size, 0)
  assert.equal(h.errors.length, 0)
})

test('CLI session listing is a successful terminal response with validated list data', async () => {
  const h = await commandHarness(['sessions'])
  h.reply({ type: 'queryFeatureSessionsResponse', featureSessions: ['component/style/test'] })
  assert.equal(h.process.exitCode, undefined)
  assert.equal(h.timers.size, 0)
  assert.deepEqual(h.logs, ['component/style/test'])
})

test('CLI command timeout fails once and cleans up the connection', async () => {
  const h = await commandHarness()
  const timeout = [...h.timers.values()][0]
  timeout()
  assert.equal(h.process.exitCode, 1)
  assert.equal(h.socket.terminated, true)
  assert.equal(h.timers.size, 0)
  assert.deepEqual(h.errors, ['DevServer 命令响应超时'])
})
