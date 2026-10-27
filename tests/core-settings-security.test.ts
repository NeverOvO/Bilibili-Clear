import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const nativeRequire = createRequire(import.meta.url)
const load = (
  file: string,
  dependencies: Record<string, unknown> = {},
  globals: Record<string, unknown> = {},
) => {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  })
  const module = { exports: {} as any }
  vm.runInNewContext(
    outputText,
    {
      module,
      exports: module.exports,
      URL,
      Buffer,
      console,
      require: (name: string) => (name in dependencies ? dependencies[name] : nativeRequire(name)),
      ...globals,
    },
    { filename: file },
  )
  return module.exports
}

test('development sockets require a loopback Host, approved Origin, and exact process session token', () => {
  const api = load('dev-tools/dev-server/security.ts')
  const request = (host: string, origin: string | undefined, token = api.sessionToken) => ({
    headers: { host, origin, 'sec-websocket-protocol': `${api.sessionProtocol}, token.${token}` },
  })
  assert.equal(
    api.isAuthenticatedSocket(request('127.0.0.1:23333', 'https://www.bilibili.com')),
    true,
  )
  assert.equal(api.isAuthenticatedSocket(request('localhost:23333', undefined)), true)
  assert.equal(
    api.isAuthenticatedSocket(request('evil.example:23333', 'https://www.bilibili.com')),
    false,
  )
  assert.equal(
    api.isAuthenticatedSocket(request('127.0.0.1:23333', 'https://www.bilibili.com.evil.example')),
    false,
  )
  assert.equal(api.isAuthenticatedSocket(request('127.0.0.1:23333', 'null')), false)
  assert.equal(
    api.isAuthenticatedSocket(
      request('127.0.0.1:23333', 'https://www.bilibili.com', '0'.repeat(64)),
    ),
    false,
  )
  assert.equal(api.isAuthenticatedSocket({ headers: { host: '127.0.0.1:23333' } }), false)
})

test('development feature paths reject traversal and symlink escapes before compilation or creation', () => {
  const api = load('dev-tools/dev-server/security.ts')
  for (const id of [
    '../outside',
    'style/../../outside',
    '/tmp/escape',
    'style%2f..%2fescape',
    'style\\escape',
    'style/./clear-home',
  ]) {
    assert.throws(() => api.getSafeFeatureDirectory('component', id))
  }
  assert.equal(api.getSafeFeatureDirectory('component', 'style/clear-home').id, 'style/clear-home')
  const escaped = load('dev-tools/dev-server/security.ts', {
    fs: {
      existsSync: () => true,
      realpathSync: (value: string) =>
        value.endsWith('/components') ? '/trusted/components' : '/outside',
    },
  })
  assert.throws(() => escaped.getSafeFeatureDirectory('component', 'style/clear-home'), /符号链接/)
  assert.throws(
    () =>
      api.parseClientPayload({
        type: 'buildFeature',
        kind: 'component',
        id: 'style/clear-home',
        mode: 'arbitrary',
      }),
    /构建模式/,
  )
})

class MockXhr extends EventTarget {
  static latest: MockXhr
  responseType = ''
  responseURL = 'https://api.bilibili.com/example?secret=redacted'
  response = ''
  responseText = ''
  status = 200
  timeout = 0
  constructor() {
    super()
    MockXhr.latest = this
  }
  open() {
    return undefined
  }
  send() {
    return undefined
  }
  setRequestHeader() {
    return undefined
  }
}
const ajax = () =>
  load(
    'src/core/ajax.ts',
    { './utils/log': { logError: () => undefined } },
    { XMLHttpRequest: MockXhr, window: { location: { href: 'https://www.bilibili.com/' } } },
  )

test('XHR requests reject HTTP, timeout and abort failures with sanitized URLs and bounded timeouts', async () => {
  const api = ajax()
  const failed = api.getText('https://api.bilibili.com/example')
  assert.equal(MockXhr.latest.timeout, 60000)
  MockXhr.latest.status = 403
  MockXhr.latest.dispatchEvent(new Event('load'))
  await assert.rejects(
    failed,
    (error: Error) => error.message.includes('HTTP 403') && !error.message.includes('secret'),
  )
  const blob = api.getBlob('https://api.bilibili.com/example')
  assert.equal(MockXhr.latest.timeout, 600000)
  MockXhr.latest.dispatchEvent(new Event('timeout'))
  await assert.rejects(blob, /timed out/)
  const aborted = api.getText('https://api.bilibili.com/example')
  MockXhr.latest.dispatchEvent(new Event('abort'))
  await assert.rejects(aborted, /aborted/)
})

test('GM requests retain explicit timeouts and reject failed statuses without exposing URL query data', async () => {
  let request: any
  const api = load(
    'src/core/ajax.ts',
    { './utils/log': { logError: () => undefined } },
    {
      GM_xmlhttpRequest: (details: any) => {
        request = details
      },
      window: { location: { href: 'https://www.bilibili.com/' } },
    },
  )
  const pending = api.monkey({
    url: 'https://api.bilibili.com/example?token=secret',
    timeout: 1200,
  })
  assert.equal(request.timeout, 1200)
  request.onload({ status: 500 })
  await assert.rejects(
    pending,
    (error: Error) => error.message.includes('HTTP 500') && !error.message.includes('secret'),
  )
})

test('pagination rejects an empty first page with a nonzero total before sending further requests', async () => {
  const api = ajax()
  const calls: number[] = []
  const config = {
    api: async (page: number) => {
      calls.push(page)
      return { list: [], total: 10000 }
    },
    getList: (json: any) => json.list,
    getTotal: (json: any) => json.total,
  }
  const [first, all] = api.responsiveGetPages(config)
  assert.equal((await first).length, 0)
  await assert.rejects(all, /Empty first page/)
  assert.deepEqual(calls, [1])
  const empty = await api.getPages({ ...config, api: async () => ({ list: [], total: 0 }) })
  assert.equal(empty.length, 0)
})
