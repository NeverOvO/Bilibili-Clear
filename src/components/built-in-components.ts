import { ComponentMetadata } from './types'
import manifest from '@/core/distribution-manifest.json'
import { distributionComponents } from './distribution-components'
import { component as SettingsPanel } from './settings-panel'
import { component as LaunchBar } from './launch-bar'
import { component as I18n } from './i18n'
import { component as AutoUpdate } from './auto-update'
import { component as NotifyNewVersion } from './notify-new-version'
import { component as Bisector } from './bisector'
import { component as Compatibilities } from './compatibilities'

export const getBuiltInComponents = (): ComponentMetadata[] => [
  SettingsPanel,
  LaunchBar,
  I18n,
  AutoUpdate,
  NotifyNewVersion,
  Bisector,
  Compatibilities,
  ...distributionComponents,
]

export const isBuiltInComponent = (name: string) =>
  manifest.components.some(c => c.name === name) ||
  getBuiltInComponents().some(c => c.name === name)
