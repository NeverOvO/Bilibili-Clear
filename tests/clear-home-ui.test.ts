import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import lodash from 'lodash'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const home = 'registry/lib/components/style/clear-home/'

// Execute the actual script logic without loading the site's DOM or userscript globals.
const load = (file: string, mocks: Record<string, unknown>, globals = {}, expose = '') => {
  const text = readFileSync(path.join(root, file), 'utf8')
  const source = file.endsWith('.vue') ? text.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1] : text
  const { outputText } = ts.transpileModule(`${source}\n${expose}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} as any }
  vm.runInNewContext(
    outputText,
    {
      module,
      exports: module.exports,
      // eslint-disable-next-line import/no-dynamic-require
      require: (name: string) => (name in mocks ? mocks[name] : require(name)),
      console,
      AbortController,
      URL,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      lodash,
      ...globals,
    },
    { filename: file },
  )
  return module.exports
}

const response = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ code: 0, data }),
})
const clock = { setTimeout, clearTimeout }

test('message badge respects notification preferences and sums only visible channels', async () => {
  let calls = 0
  const module = load(
    `${home}messages.ts`,
    { '@/core/utils': { getUID: () => '123' } },
    {
      window: clock,
      fetch: async (url: string, init: RequestInit) => {
        calls += 1
        assert.equal(init.credentials, 'include')
        if (url.includes('link_setting')) {
          return response({ msg_notify: 1, show_unfollowed_msg: 1 })
        }
        if (url.includes('msgfeed')) {
          return response({ reply: 2, at: '3', like: 4, sys_msg: 5 })
        }
        return response({ follow_unread: 6, unfollow_unread: 100 })
      },
    },
  )
  assert.equal((await module.fetchMessageUnread()).count, 20)
  assert.equal(calls, 3)
  const disabled = load(
    `${home}messages.ts`,
    { '@/core/utils': { getUID: () => '123' } },
    {
      window: clock,
      fetch: async () => response({ msg_notify: 3 }),
    },
  )
  assert.equal((await disabled.fetchMessageUnread()).count, 0)
})

test('message reads reject account switches, malformed counts, and pre-aborted requests', async () => {
  let uid = '123'
  const module = load(
    `${home}messages.ts`,
    { '@/core/utils': { getUID: () => uid } },
    {
      window: clock,
      fetch: async () => {
        uid = '456'
        return response({ msg_notify: 1, show_unfollowed_msg: 1 })
      },
    },
  )
  await assert.rejects(
    module.fetchMessageUnread(),
    (error: any) => error.kind === 'account-changed',
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    module.fetchMessageUnread(controller.signal),
    (error: any) => error.kind === 'aborted',
  )
  const malformed = load(
    `${home}messages.ts`,
    { '@/core/utils': { getUID: () => '123' } },
    {
      window: clock,
      fetch: async () => response({ msg_notify: null }),
    },
  )
  await assert.rejects(malformed.fetchMessageUnread(), (error: any) => error.kind === 'format')
})

test('message navigation cannot apply an old account response after a new request', async () => {
  let uid = '123'
  const pending: ((value: unknown) => void)[] = []
  const component = load(
    `${home}HomeNavigation.vue`,
    {
      vue: { defineComponent: (value: unknown) => value },
      '@/core/utils': { getUID: () => uid },
      '@/components/launch-bar/LaunchBar.vue': {},
      './messages': { fetchMessageUnread: () => new Promise(resolve => pending.push(resolve)) },
    },
    {
      document: { hidden: false },
      window: { setTimeout: () => 1, clearTimeout: () => undefined },
    },
  ).default
  const state = { ...component.data(), active: true }
  Object.entries(component.methods).forEach(([name, method]: [string, any]) => {
    state[name] = method.bind(state)
  })
  const oldRead = state.refreshMessages()
  uid = '456'
  const newRead = state.refreshMessages()
  pending[1]({ accountId: '456', count: 8, notificationsEnabled: true })
  await newRead
  pending[0]({ accountId: '123', count: 99, notificationsEnabled: true })
  await oldRead
  assert.equal(state.accountId, '456')
  assert.equal(state.count, 8)
  state.pauseRefresh()
})

test('suggestions encode query parameters and render API content as text nodes', async () => {
  let requested = ''
  const value = '<img src=x onerror=alert(1)> hello'
  const module = load(
    'src/components/launch-bar/search-provider.ts',
    {
      '@/core/utils': { getUID: () => '123' },
      '@/core/ajax': {
        getJson: async (url: string) => {
          requested = url
          return {
            code: 0,
            result: { tag: [{ value, name: '<script>alert(1)</script>' }, { value: null }] },
          }
        },
      },
      './history-provider': { addHistoryItem: async () => undefined },
    },
    { Vue: { extend: (options: unknown) => options } },
  )
  const query = 'hello&userid=999#fragment'
  const entries = await module.searchProvider.getActions(query)
  assert.equal(new URL(requested).searchParams.get('term'), query)
  assert.equal(new URL(requested).searchParams.get('userid'), '123')
  assert.equal(entries.length, 2)
  const content = await entries[1].content()
  const rendered = content.render((tag: string, children: unknown) => ({ tag, children }))
  assert.equal(rendered.children[0], value)
  assert.equal(JSON.stringify(rendered).includes('innerHTML'), false)
})

test('failed suggestion endpoint still offers direct keyword search', async () => {
  const module = load(
    'src/components/launch-bar/search-provider.ts',
    {
      '@/core/utils': { getUID: () => '123' },
      '@/core/ajax': {
        getJson: async () => {
          throw new Error('offline')
        },
      },
      './history-provider': { addHistoryItem: async () => undefined },
    },
    { Vue: { extend: (value: unknown) => value } },
  )
  const entries = await module.searchProvider.getActions('hello')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].name, 'hello')
})

test('corrupt search history becomes an empty list and malformed entries are excluded', async () => {
  let data = '{not json'
  const module = load('src/components/launch-bar/history-provider.ts', {
    '@/core/local-storage': { crossOriginLocalStorage: { getItem: async () => data } },
  })
  assert.equal((await module.getHistoryItems()).length, 0)
  data = JSON.stringify([null, { value: '<script>', timestamp: 4 }, { value: 2, timestamp: 4 }])
  const items = await module.getHistoryItems()
  assert.equal(items.length, 1)
  assert.equal(items[0].value, '<script>')
})

test('nested wrapper roots resolve the real VPopup owner before Escape is consumed', () => {
  const module = load('src/components/settings-panel/popup-owner.ts', {})
  const element = {} as any
  const popup = { $el: element, $options: { name: 'VPopup' }, $children: [] }
  // eslint-disable-next-line no-underscore-dangle
  element.__vue__ = {
    $el: element,
    $options: { name: 'Widget' },
    $children: [{ $el: element, $options: { name: 'Wrapper' }, $children: [popup] }],
  }
  assert.equal(module.getPopupOwner(element), popup)
  assert.equal(module.getPopupOwner({}), null)
})

test('widget grid counts multiple entry providers without counting their option popup', () => {
  const component = load(
    'src/components/settings-panel/WidgetsPanel.vue',
    {
      '@/components/widget': {},
      '@/core/observer': {},
      '@/core/utils': {},
      '@/ui/clear/ClearActionIcon.vue': {},
      '../../plugins/data': {},
      '.': {},
      './popup-owner': {},
    },
    { Vue: { extend: (value: unknown) => value } },
  ).default
  const node = (names: string[], children = []) => ({
    classList: { contains: (name: string) => names.includes(name) },
    children,
  })
  const grid = node(
    [],
    [
      node([]),
      node(
        ['multiple-widgets'],
        [
          node([]),
          node([]),
          node(['multiple-widgets'], [node([]), node([]), node([])]),
          node(['be-popup']),
        ],
      ),
    ],
  )
  const state = { $refs: { widgetItems: grid }, renderedTileCount: 0 }
  component.methods.updateTileCount.call(state)
  assert.equal(state.renderedTileCount, 6)
})

const launchBar = (providers: any[], history: () => Promise<any[]>) => {
  let unmount = () => undefined
  const source = load(
    'src/components/launch-bar/LaunchBar.vue',
    {
      vue: {
        ref: (value: unknown) => ({ value }),
        computed: (get: () => unknown) => ({
          get value() {
            return get()
          },
        }),
        nextTick: async (callback?: () => void) => callback?.(),
        onMounted: () => undefined,
        onBeforeUnmount: (callback: () => void) => {
          unmount = callback
        },
      },
      'fuse.js': {
        default: class {
          constructor(public items: unknown[]) {}
          search() {
            return this.items.map(item => ({ item }))
          }
        },
      },
      '@/ui': {},
      '@/plugins/data': {
        registerAndGetData: (key: string) =>
          key === 'launchBar.recommended'
            ? [{ word: '搜索', href: 'https://search.bilibili.com/' }]
            : [providers],
      },
      '@/core/spin-query': {},
      '@/core/utils': {},
      '@/core/observer': {},
      '@/core/utils/sort': {
        ascendingSort: (key: (value: any) => number) => (a: any, b: any) => key(a) - key(b),
      },
      './ActionItem.vue': {},
      './launch-bar-action': { LaunchBarActionProviders: 'providers' },
      './search-provider': {},
      './history-provider': { historyProvider: { name: 'history', getActions: history } },
    },
    {
      defineProps: () => undefined,
      defineEmits: () => () => undefined,
      defineExpose: () => undefined,
    },
    'export const scenario = { query, actions, noOnlineActions, getActions, getOnlineActions }',
  )
  return { ...source.scenario, unmount: () => unmount() }
}

test('suggestion generations isolate repeated queries and disposed instances', async () => {
  const reads: ((items: any[]) => void)[] = []
  const bar = launchBar(
    [{ name: 'online', getActions: () => new Promise(resolve => reads.push(resolve)) }],
    async () => [],
  )
  const request = async (query: string) => {
    bar.query.value = query
    await bar.getActions()
    return { result: bar.getOnlineActions.flush() }
  }
  const oldA = await request('alpha')
  const oldB = await request('beta')
  const newA = await request('alpha')
  reads[2]([{ name: 'new alpha' }])
  await newA.result
  reads[0]([{ name: 'old alpha' }])
  reads[1]([{ name: 'old beta' }])
  await Promise.all([oldA.result, oldB.result])
  assert.equal(bar.actions.value[0].name, 'new alpha')
  const last = await request('last')
  bar.unmount()
  reads[3]([{ name: 'disposed result' }])
  await last.result
  assert.equal(bar.actions.value.length, 0)
})

test('slow history cannot replace newer suggestions and failed providers cannot block them', async () => {
  let resolveHistory: (items: any[]) => void
  const bar = launchBar(
    [
      {
        name: 'failing',
        getActions: async () => {
          throw new Error('offline')
        },
      },
      { name: 'working', getActions: async () => [{ name: 'new keyword' }] },
    ],
    () =>
      new Promise(resolve => {
        resolveHistory = resolve
      }),
  )
  const history = bar.getActions()
  bar.query.value = 'new'
  await bar.getActions()
  await bar.getOnlineActions.flush()
  resolveHistory([{ name: 'old history' }])
  await history
  assert.equal(bar.actions.value[0].name, 'new keyword')
  assert.equal(bar.noOnlineActions.value, false)
  bar.unmount()
})

const updater = () => {
  const settings = { userComponents: {}, userPlugins: {}, userStyles: {} } as any
  const options = {
    minimumDuration: 0,
    urls: { components: {}, plugins: {}, styles: {} },
  } as any
  const installs: any[][] = []
  let download: () => Promise<string> = async () => 'code'
  const utils = load('src/components/auto-update/utils.ts', {
    '@/core/settings': { settings },
    '@/core/distribution-manifest.json': { default: { components: [], plugins: [] } },
  })
  const checker = load(
    'src/components/auto-update/checker.ts',
    {
      '@/core/meta': { meta: { version: '3.2.1' } },
      '@/core/settings': {
        getGeneralSettings: () => ({ devMode: false }),
        getComponentSettings: () => ({ options }),
      },
      '@/core/utils/log': { useScopedConsole: () => console },
      '@/core/utils/sort': {
        descendingSort: (key: (item: any) => number) => (a: any, b: any) => key(b) - key(a),
      },
      '@/core/utils': { isDataSaveMode: () => false },
      '@/core/install-feature': {
        installFeatureFromCode: async (...args: any[]) => {
          installs.push(args)
          return { message: 'installed' }
        },
      },
      './utils': utils,
    },
    {
      coreApis: { ajax: { monkey: () => download() } },
      window: { location: { reload: () => undefined } },
    },
  )
  const record = () => ({ url: 'https://example.test/feature.js', lastUpdateCheck: 0 })
  return {
    settings,
    options,
    checker,
    installs,
    record,
    setDownload: (handler: () => Promise<string>) => {
      download = handler
    },
  }
}

test('feature update cannot reinstall an uninstalled component with a same-named plugin', async () => {
  const state = updater()
  state.settings.userComponents.shared = {}
  state.settings.userPlugins.shared = {}
  state.options.urls.components.shared = state.record()
  state.setDownload(async () => {
    delete state.settings.userComponents.shared
    return 'code'
  })
  await state.checker.checkComponentsUpdate({ force: true })
  assert.equal(state.installs.length, 0)
})

test('feature update discards downloads after update URL or record replacement', async () => {
  for (const replace of [false, true]) {
    const state = updater()
    state.settings.userComponents.shared = {}
    state.options.urls.components.shared = state.record()
    state.setDownload(async () => {
      if (replace) {
        state.options.urls.components.shared = state.record()
      } else {
        state.options.urls.components.shared.url = 'https://example.test/changed.js'
      }
      return 'code'
    })
    await state.checker.checkComponentsUpdate({ force: true })
    assert.equal(state.installs.length, 0)
  }
})

test('last-feature update retains exact type and updates the original live group only', async () => {
  const state = updater()
  state.settings.userComponents.shared = {}
  state.settings.userPlugins.shared = {}
  state.options.urls.components.shared = state.record()
  state.options.urls.plugins.shared = { ...state.record(), lastUpdateCheck: 10 }
  await state.checker.checkLastFeature()
  assert.equal(state.installs.length, 1)
  assert.equal(state.installs[0][2], 'shared')
  assert.equal(state.installs[0][3], 'plugin')
  assert.equal(state.options.urls.components.shared.lastUpdateCheck, 0)
  assert.ok(state.options.urls.plugins.shared.lastUpdateCheck > 10)
})

test('last-feature update discards a record removed while downloading', async () => {
  const state = updater()
  state.settings.userComponents.shared = {}
  state.options.urls.components.shared = state.record()
  state.setDownload(async () => {
    delete state.options.urls.components.shared
    return 'code'
  })
  await state.checker.checkLastFeature()
  assert.equal(state.installs.length, 0)
})
