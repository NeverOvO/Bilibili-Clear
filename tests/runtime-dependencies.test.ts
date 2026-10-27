import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import lodash from 'lodash'
import * as marked from 'marked'
import * as protobuf from 'protobufjs/light'
import ts from 'typescript'

const loadModule = (filename: string, imports: Record<string, unknown>, globals = {}) => {
  const code = ts.transpileModule(readFileSync(path.resolve(filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exported: Record<string, any> = {}
  vm.runInNewContext(
    code,
    {
      exports: exported,
      module: { exports: exported },
      Blob,
      Uint8Array,
      Promise,
      console,
      require(id: string) {
        assert.ok(id in imports, `Unexpected dependency: ${id}`)
        return imports[id]
      },
      ...globals,
    },
    { filename },
  )
  return exported
}

test('description and release notes retain synchronous Markdown HTML with the named export', async () => {
  const description = loadModule('src/components/description.ts', {
    marked,
    './i18n/helpers': { getSelectedLanguage: () => 'zh-CN' },
  })
  const html = await description.getDescriptionHTML({
    author: { name: 'maintainer', link: 'https://github.com/NeverOvO' },
    description: { 'zh-CN': '**已启用**\n\n- 保留说明\n- 支持列表' },
  })
  assert.equal(typeof html, 'string')
  assert.match(html, /<strong>已启用<\/strong>/)
  assert.match(html, /<li>支持列表<\/li>/)
  assert.match(html, /href="https:\/\/github.com\/NeverOvO"/)

  const release = loadModule('src/components/notify-new-version/release-content.ts', {
    marked,
    '@/core/ajax': {
      monkey: async () => JSON.stringify({ body: '# 更新说明\n\n修复 **播放**。' }),
    },
  })
  assert.match(await release.getReleaseContent('3.2.0'), /<strong>播放<\/strong>/)
})

test('patched lodash retains settings merge and curry while rejecting unsafe template imports', () => {
  assert.deepEqual(lodash.merge({}, { options: { enabled: true } }, { options: { size: 2 } }), {
    options: { enabled: true, size: 2 },
  })
  assert.equal(lodash.curry((first: number, second: number) => first + second)(2)(3), 5)
  assert.throws(() => lodash.template('', { imports: { 'invalid=1': 1 } }))
})

test('protobuf light decodes the actual danmaku segment and view schemas', async () => {
  const converter = loadModule(
    'registry/lib/components/video/danmaku/converter/danmaku-segment.ts',
    {
      '@/core/runtime-library': { protobufLibrary: Promise.resolve(protobuf) },
    },
    { lodash },
  )
  const root = protobuf.Root.fromJSON(converter.proto)
  const segmentType = root.lookupType('DmSegMobileReply')
  const segment = segmentType
    .encode({ elems: [{ progress: 1200, content: '极简B站', idStr: '12345678901234567' }] })
    .finish()
  const decoded = await converter.decodeDanmakuSegment(new Blob([segment]))
  assert.equal(decoded.elems[0].content, '极简B站')
  assert.equal(decoded.elems[0].progress, 1200)
  assert.equal(decoded.elems[0].idStr, '12345678901234567')

  const viewType = root.lookupType('DmWebViewReply')
  const view = viewType
    .encode({ state: 0, dmSge: { pageSize: 6000, total: 3 }, count: 42 })
    .finish()
  const decodedView = await converter.decodeDanmakuView(new Blob([view]))
  assert.equal(Number(decodedView.count), 42)
  assert.equal(Number(decodedView.dmSge.total), 3)
})

test('patched PostCSS preserves Vue 2 scoped style compilation', () => {
  const fromLoader = createRequire(require.resolve('vue-loader/package.json'))
  const { compileStyle } = fromLoader('@vue/component-compiler-utils')
  const result = compileStyle({
    source: '.tile:hover { color: #00a1d6; } .tile > .icon { width: 24px; }',
    filename: 'AuditStyle.vue',
    id: 'data-v-audit',
    scoped: true,
  })
  assert.deepEqual(result.errors, [])
  assert.match(result.code, /\.tile\[data-v-audit\]:hover/)
  assert.match(result.code, /\.icon\[data-v-audit\]/)
  assert.match(result.code, /width: 24px/)
})
