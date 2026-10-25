import webpack from 'webpack'
import coreConfigs from './webpack.prod'
import { buildByEntry } from '../registry/webpack/config'

// HomeFix keeps the upstream registry for other features and ships these replacements.
const componentIds = [
  'style/simplify/home',
  'style/custom-navbar',
  'utils/remove-promotions',
  'style/hide/video/recommended-live',
]
const componentConfigs = componentIds.map(id => {
  const config = buildByEntry({
    src: './registry/lib/components/',
    type: 'component',
    entry: `./registry/lib/components/${id}/index.ts`,
  })
  config.plugins = config.plugins.filter(plugin => !(plugin instanceof webpack.SourceMapDevToolPlugin))
  config.plugins.push(
    new webpack.SourceMapDevToolPlugin({
      filename: '[file].map',
      publicPath:
        'https://raw.githubusercontent.com/NeverOvO/Bilibili-Evolved-HomeFix/master/registry/dist/components/',
      append: '\n//# sourceMappingURL=[url]',
    }),
  )
  return config
})

export default [coreConfigs[0], ...componentConfigs]
