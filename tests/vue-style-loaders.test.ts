import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import webpack from 'webpack'
import VueLoaderPlugin from 'vue-loader/lib/plugin'
import { cssStyleLoaders, styleLoader } from '../webpack/loaders/style-loaders'
import transform from '../webpack/loaders/vue-style-imports.cjs'

test('Vue style import compatibility preserves CSS module bindings and skips subresources', () => {
  const source = [
    'import style0 from "./Fixture.vue?vue&type=style&index=0&scoped=true"',
    'import style1 from "./Fixture.vue?vue&type=style&index=1&module=true"',
    'import script from "./Fixture.vue?vue&type=script&lang=js"',
  ].join('\n')
  const result = transform.call({ resourceQuery: '' }, source)
  assert.match(result, /^import "\.\/Fixture.vue\?vue&type=style&index=0&scoped=true"/)
  assert.match(result, /import style1 from /)
  assert.match(result, /import script from /)
  assert.equal(transform.call({ resourceQuery: '?vue&type=script' }, source), source)
})

test('real Vue compilation has no style export warnings and injects ordinary and scoped CSS', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bilibili-clear-style-test-'))
  try {
    const filename = path.join(directory, 'Fixture.vue')
    writeFileSync(
      filename,
      `
<template><div class="ordinary scoped">style fixture</div></template>
<script>export default { name: 'StyleFixture' }</script>
<style>.ordinary { color: rgb(0, 161, 214); }</style>
<style scoped>.scoped { display: grid; }</style>
`,
    )
    const compiler = webpack({
      mode: 'production',
      entry: filename,
      devtool: false,
      output: { path: directory, filename: 'fixture.js', library: { type: 'commonjs2' } },
      module: {
        rules: [
          { test: /\.css$/, use: [styleLoader, ...cssStyleLoaders] },
          {
            test: /\.vue$/,
            use: [
              { loader: path.resolve('webpack/loaders/vue-style-imports.cjs') },
              { loader: require.resolve('vue-loader'), options: { hotReload: false } },
            ],
          },
        ],
      },
      plugins: [new VueLoaderPlugin()],
    })
    const stats = await new Promise<webpack.Stats>((resolve, reject) => {
      compiler.run((error, result) => {
        compiler.close(closeError => {
          if (error || closeError) {
            reject(error || closeError)
          } else {
            resolve(result)
          }
        })
      })
    })
    assert.equal(stats.hasErrors(), false, stats.toString('errors-warnings'))
    assert.equal(stats.hasWarnings(), false, stats.toString('errors-warnings'))

    const styles: { childNodes: { textContent: string }[] }[] = []
    const document = {
      querySelector: () => ({
        appendChild: (element: (typeof styles)[number]) => styles.push(element),
      }),
      createElement: () => ({
        childNodes: [],
        setAttribute: () => undefined,
        removeAttribute: () => undefined,
        appendChild(node: { textContent: string }) {
          this.childNodes.push(node)
        },
      }),
      createTextNode: (textContent: string) => ({ textContent }),
    }
    const module = { exports: {} as { default?: { _scopeId: string } } }
    vm.runInNewContext(readFileSync(path.join(directory, 'fixture.js'), 'utf8'), {
      document,
      window: {},
      module,
      exports: module.exports,
    })
    const css = styles.flatMap(style => style.childNodes.map(node => node.textContent)).join('\n')
    assert.equal(styles.length, 2)
    assert.match(css, /\.ordinary\s*\{/)
    assert.match(css, /color:\s*rgb\(0,\s*161,\s*214\)/)
    assert.match(css, /\.scoped\[data-v-[\da-f]+\]/)
    assert.match(css, /display:\s*grid/)
    assert.match(Reflect.get(module.exports.default, '_scopeId'), /^data-v-/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
