import type { Settings } from './types'

export interface DistributionManifest {
  schemaVersion: number
  components: { name: string }[]
  plugins: { name: string }[]
}
export const settingsStorageKeys: string[]
export function validateSettingsExport<T>(input: T, options?: { partial?: boolean }): T
export function mergeSettingsDefaults<T>(saved: Partial<T> | undefined, defaults: T): T
export function migrateSettings(input: Partial<Settings>, manifest: DistributionManifest): Settings
