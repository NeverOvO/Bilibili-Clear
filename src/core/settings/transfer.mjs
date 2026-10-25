/** Shared by the userscript and the local settings converter. Never evaluates feature code. */
export const settingsStorageKeys = [
  'userStyles',
  'userPlugins',
  'userComponents',
  'components',
  'plugins',
  'schemaVersion',
]
const groups = settingsStorageKeys.filter(key => key !== 'schemaVersion')
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = (path, message) => {
  throw new Error(`设置格式错误: ${path} ${message}`)
}
const record = (value, path) => {
  if (!isRecord(value)) {
    fail(path, '必须是对象')
  }
  return value
}
const text = (value, path) => {
  if (typeof value !== 'string') {
    fail(path, '必须是字符串')
  }
}
const componentSettings = (value, path) => {
  record(value, path)
  if (typeof value.enabled !== 'boolean') {
    fail(`${path}.enabled`, '必须是布尔值')
  }
  record(value.options, `${path}.options`)
}

export const validateSettingsExport = (input, { partial = false } = {}) => {
  record(input, 'root')
  let entries = 0
  const inspect = (value, path, depth = 0) => {
    entries += 1
    if (depth > 64 || entries > 200000) {
      fail(path, '结构过深或数据项过多')
    }
    if (value === null || ['string', 'boolean'].includes(typeof value)) {
      return
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return
    }
    if (typeof value !== 'object') {
      fail(path, '包含不能导入的值')
    }
    for (const [key, child] of Object.entries(value)) {
      if (unsafeKeys.has(key)) {
        fail(`${path}.${key}`, '不是允许的字段名')
      }
      inspect(child, `${path}.${key}`, depth + 1)
    }
  }
  inspect(input, 'root')
  for (const group of groups) {
    if (!(group in input) && partial) {
      continue
    }
    record(input[group], group)
  }
  if ('schemaVersion' in input && (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 0)) {
    fail('schemaVersion', '必须是非负整数')
  }
  for (const [name, value] of Object.entries(input.components ?? {})) {
    componentSettings(value, `components.${name}`)
  }
  for (const [name, value] of Object.entries(input.userComponents ?? {})) {
    const path = `userComponents.${name}`
    record(value, path)
    text(value.code, `${path}.code`)
    record(value.metadata, `${path}.metadata`)
    if (value.metadata.name !== name) {
      fail(`${path}.metadata.name`, '必须与组件名称一致')
    }
    componentSettings(value.settings, `${path}.settings`)
  }
  for (const [name, value] of Object.entries(input.userPlugins ?? {})) {
    const path = `userPlugins.${name}`
    record(value, path)
    text(value.code, `${path}.code`)
    if (value.name !== name) {
      fail(`${path}.name`, '必须与插件名称一致')
    }
  }
  for (const [name, value] of Object.entries(input.plugins ?? {})) {
    if (typeof value !== 'boolean') {
      fail(`plugins.${name}`, '必须是布尔值')
    }
  }
  for (const [name, value] of Object.entries(input.userStyles ?? {})) {
    const path = `userStyles.${name}`
    record(value, path)
    if (value.name !== name) {
      fail(`${path}.name`, '必须与样式名称一致')
    }
    text(value.style, `${path}.style`)
    if (value.mode !== undefined && !['default', 'instant', 'important'].includes(value.mode)) {
      fail(`${path}.mode`, '不是支持的样式模式')
    }
  }
  const urls = input.components?.autoUpdate?.options?.urls
  if (urls !== undefined) {
    record(urls, 'components.autoUpdate.options.urls')
    for (const [kind, items] of Object.entries(urls)) {
      record(items, `components.autoUpdate.options.urls.${kind}`)
      for (const [name, item] of Object.entries(items)) {
        const path = `components.autoUpdate.options.urls.${kind}.${name}`
        record(item, path)
        text(item.url, `${path}.url`)
        for (const field of ['lastUpdateCheck', 'lastUpdateAttempt', 'installTime']) {
          if (item[field] !== undefined && (typeof item[field] !== 'number' || !Number.isFinite(item[field]) || item[field] < 0)) {
            fail(`${path}.${field}`, '必须是非负时间戳')
          }
        }
      }
    }
  }
  return input
}

/** Fill missing object fields while preserving saved arrays and explicit false/zero values. */
export const mergeSettingsDefaults = (saved, defaults) => {
  if (saved === undefined) {
    if (Array.isArray(defaults)) {
      return defaults.map(value => mergeSettingsDefaults(undefined, value))
    }
    if (isRecord(defaults)) {
      return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, mergeSettingsDefaults(undefined, value)]))
    }
    return defaults
  }
  if (isRecord(saved) && isRecord(defaults)) {
    return Object.fromEntries(
      [...new Set([...Object.keys(defaults), ...Object.keys(saved)])]
        .filter(key => !unsafeKeys.has(key))
        .map(key => [key, mergeSettingsDefaults(saved[key], defaults[key])]),
    )
  }
  if (Array.isArray(saved)) {
    return saved.map(value => mergeSettingsDefaults(undefined, value))
  }
  return saved
}

export const migrateSettings = (input, manifest) => {
  validateSettingsExport(input, { partial: true })
  if ((input.schemaVersion ?? 0) > manifest.schemaVersion) {
    fail('schemaVersion', '高于当前脚本支持的版本，请先更新脚本')
  }
  const migrated = JSON.parse(JSON.stringify(input))
  groups.forEach(group => {
    migrated[group] ??= {}
  })
  const isLegacy = (migrated.schemaVersion ?? 0) < 1
  for (const { name } of manifest.components) {
    const installed = migrated.userComponents[name]
    if (installed) {
      migrated.components[name] = isLegacy
        ? mergeSettingsDefaults(installed.settings, migrated.components[name])
        : mergeSettingsDefaults(migrated.components[name], installed.settings)
      delete migrated.userComponents[name]
    }
    delete migrated.components.autoUpdate?.options?.urls?.components?.[name]
  }
  for (const { name } of manifest.plugins) {
    if (migrated.userPlugins[name]) {
      migrated.plugins[name] ??= true
      delete migrated.userPlugins[name]
    }
    delete migrated.components.autoUpdate?.options?.urls?.plugins?.[name]
  }
  const navbar = migrated.components.customNavbar?.options
  if (navbar) {
    const aliases = { gamesIframe: 'games', livesIframe: 'lives', mangaIframe: 'manga' }
    if (Array.isArray(navbar.hidden)) {
      navbar.hidden = [...new Set(navbar.hidden.map(name => aliases[name] ?? name))]
    }
    for (const field of ['order', 'openInNewTabOverrides']) {
      if (isRecord(navbar[field])) {
        for (const [from, to] of Object.entries(aliases)) {
          if (Object.hasOwn(navbar[field], from)) {
            navbar[field][to] ??= navbar[field][from]
            delete navbar[field][from]
          }
        }
      }
    }
  }
  migrated.schemaVersion = manifest.schemaVersion
  return migrated
}
