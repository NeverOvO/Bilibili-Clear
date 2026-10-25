import type { PluginMetadata } from './plugin'

/** Keep registry module evaluation out of the core's settings initialization cycle. */
export const getDistributionPlugins = (): PluginMetadata[] => [
  {
    name: 'settingsPanel.tagFilters.recentComponents',
    displayName: '设置面板 - 最近使用',
    setup: async context => {
      const { plugin } = await import('../../registry/lib/plugins/settings-panel/recent-components')
      return plugin.setup(context)
    },
  },
]
