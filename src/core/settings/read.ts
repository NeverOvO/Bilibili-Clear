import manifest from '@/core/distribution-manifest.json'
import {
  mergeSettingsDefaults,
  migrateSettings,
  settingsStorageKeys,
  validateSettingsExport,
} from './transfer.mjs'
import type { Settings } from './types'

/** Import is staged in one storage write, and consumed before any feature code is loaded. */
export const pendingSettingsImportKey = 'clearPendingSettingsImport'
const invalidStoredGroups = new Set<string>()
let consumingImport = false

// Migration moves records between groups, so partial persistence could otherwise lose data.
export const canPersistSettingsGroup = (_key: string) => invalidStoredGroups.size === 0

export const mergeValue = (gmValue: any, currentValue: any) =>
  mergeSettingsDefaults(gmValue, currentValue)

export const readSettings = (defaults: Settings): Settings => {
  const pendingImport = GM_getValue(pendingSettingsImportKey, undefined)
  let saved: Partial<Settings> = {}
  if (pendingImport !== undefined) {
    try {
      validateSettingsExport(pendingImport)
      saved = migrateSettings(pendingImport, manifest)
      consumingImport = true
    } catch (error) {
      console.error('未应用无效的设置导入，现有配置保持不变。', error)
      GM_deleteValue(pendingSettingsImportKey)
    }
  }
  if (!consumingImport) {
    for (const key of settingsStorageKeys) {
      const value = GM_getValue(key, undefined)
      if (value === undefined) {
        continue
      }
      try {
        validateSettingsExport({ [key]: value }, { partial: true })
        saved[key] = value
      } catch (error) {
        // Keep invalid persisted data intact; use defaults for this session so the settings UI works.
        invalidStoredGroups.add(key)
        console.error(`已暂用 ${key} 的默认设置，原存储未改写。`, error)
      }
    }
    if ((saved.schemaVersion ?? 0) > manifest.schemaVersion) {
      settingsStorageKeys.forEach(key => invalidStoredGroups.add(key))
      console.error('已有设置来自更新版本；本次使用默认设置，原存储未改写。请更新 Bilibili Clear。')
      return mergeSettingsDefaults(undefined, defaults)
    }
    saved = migrateSettings(saved, manifest)
  }
  return mergeSettingsDefaults(saved, defaults)
}

export const persistInitialSettings = (settings: Settings) => {
  if (invalidStoredGroups.size > 0) {
    import('@/core/toast').then(({ Toast }) => {
      Toast.error('旧配置格式异常，当前设置仅在本页临时生效，原数据未改写。请在关于面板导入有效的设置文件。', '设置恢复')
    }).catch(error => console.error('设置恢复提示加载失败', error))
    return
  }
  try {
    for (const key of settingsStorageKeys) {
      if (!canPersistSettingsGroup(key)) {
        continue
      }
      GM_setValue(key, settings[key])
    }
    if (consumingImport) {
      GM_deleteValue(pendingSettingsImportKey)
    }
  } catch (error) {
    // A pending import remains authoritative on the next startup if any write was interrupted.
    console.error('设置存储未完成，请检查脚本管理器的存储权限。', error)
  }
}

export const stageSettingsImport = (input: unknown) => {
  validateSettingsExport(input)
  const migrated = migrateSettings(input as Settings, manifest)
  GM_setValue(pendingSettingsImportKey, migrated)
}
