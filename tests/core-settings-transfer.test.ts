import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as transfer from '../src/core/settings/transfer.mjs'

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const manifest = {
  schemaVersion: 1,
  components: [{ name: 'customNavbar' }],
  plugins: [{ name: 'testPlugin' }],
}
const defaults = () => ({
  schemaVersion: 1,
  userStyles: {},
  userPlugins: {},
  userComponents: {},
  components: {},
  plugins: {},
})
const legacy = () => ({
  ...defaults(),
  schemaVersion: 0,
  userComponents: {
    customNavbar: {
      code: 'legacy code',
      metadata: { name: 'customNavbar' },
      settings: {
        enabled: false,
        options: { hidden: ['gamesIframe'], order: { gamesIframe: 4 }, savedPreference: 'keep me' },
      },
    },
  },
  userPlugins: { testPlugin: { name: 'testPlugin', code: 'legacy plugin' } },
  plugins: { testPlugin: false },
})
const storageFor = (settings: object) => new Map<string, any>(Object.entries(plain(settings)))
const loadRead = (storage: Map<string, any>, failKey?: string) => {
  const calls: string[] = []
  const source = readFileSync(path.join(process.cwd(), 'src/core/settings/read.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, {
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
      console: { error: () => undefined },
      require: (name: string) => {
        if (name === '@/core/distribution-manifest.json') {
          return manifest
        }
        if (name === './transfer.mjs') {
          return transfer
        }
        if (name === '@/core/toast') {
          return { Toast: { error: () => undefined } }
        }
        throw new Error(`Unmocked dependency: ${name}`)
      },
      GM_getValue: (key: string, fallback: unknown) =>
        storage.has(key) ? plain(storage.get(key)) : fallback,
      GM_setValue: (key: string, value: unknown) => {
        calls.push(key)
        if (key === failKey) {
          throw new Error('simulated storage write failure')
        }
        storage.set(key, plain(value))
      },
      GM_deleteValue: (key: string) => storage.delete(key),
    },
    { filename: 'read.ts' },
  )
  return { api: module.exports, calls }
}

test('legacy migration preserves explicit choices and migrates aliases without retaining bundled executable copies', () => {
  const migrated = transfer.migrateSettings(legacy() as any, manifest)
  assert.equal(migrated.components.customNavbar.enabled, false)
  assert.equal(migrated.components.customNavbar.options.savedPreference, 'keep me')
  assert.deepEqual(migrated.components.customNavbar.options.hidden, ['games'])
  assert.deepEqual(migrated.components.customNavbar.options.order, { games: 4 })
  assert.equal(migrated.plugins.testPlugin, false)
  assert.deepEqual(migrated.userComponents, {})
  assert.deepEqual(migrated.userPlugins, {})
})

test('settings import rejects prototype keys recursively and default merges preserve explicit arrays and false values', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const input = JSON.parse(
      `{"components":{"example":{"enabled":true,"options":{"${key}":{"polluted":true}}}}}`,
    )
    assert.throws(
      () => transfer.validateSettingsExport(input, { partial: true }),
      /不是允许的字段名/,
    )
  }
  const merged = transfer.mergeSettingsDefaults(
    { enabled: false, options: { hidden: [], order: { a: 0 } } },
    { enabled: true, options: { hidden: ['default'], order: { a: 1, b: 2 } } },
  )
  assert.deepEqual(merged, { enabled: false, options: { hidden: [], order: { a: 0, b: 2 } } })
})

test('normal migration recovers from a write failure after old user-feature records were removed', () => {
  const storage = storageFor(legacy())
  const first = loadRead(storage, 'components')
  const migrated = first.api.readSettings(defaults())
  first.api.persistInitialSettings(migrated)
  const key = first.api.pendingSettingsImportKey
  assert.equal(first.calls[0], key)
  assert.deepEqual(storage.get('userComponents'), {})
  assert.equal(storage.has(key), true)
  assert.equal(first.api.canPersistSettingsGroup(), false)
  const restart = loadRead(storage)
  const recovered = restart.api.readSettings(defaults())
  assert.equal(recovered.components.customNavbar.options.savedPreference, 'keep me')
  assert.equal(recovered.components.customNavbar.enabled, false)
  assert.equal(recovered.plugins.testPlugin, false)
  restart.api.persistInitialSettings(recovered)
  assert.equal(storage.has(key), false)
  assert.equal(storage.get('components').customNavbar.options.savedPreference, 'keep me')
})

test('failed journal creation leaves all original setting groups untouched', () => {
  const original = legacy()
  const storage = storageFor(original)
  const { api, calls } = loadRead(storage, 'clearPendingSettingsImport')
  api.persistInitialSettings(api.readSettings(defaults()))
  assert.deepEqual(calls, ['clearPendingSettingsImport'])
  assert.deepEqual(Object.fromEntries(storage), original)
  assert.equal(api.canPersistSettingsGroup(), false)
})

test('an unchanged current-schema startup avoids a migration journal write', () => {
  const storage = storageFor(defaults())
  const { api, calls } = loadRead(storage)
  api.persistInitialSettings(api.readSettings(defaults()))
  assert.equal(calls.includes(api.pendingSettingsImportKey), false)
  assert.deepEqual(calls, transfer.settingsStorageKeys)
})
