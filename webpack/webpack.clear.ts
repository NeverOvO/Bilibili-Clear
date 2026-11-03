import path from 'path'
import webpack from 'webpack'
import coreConfigs from './webpack.prod'
import { getDefaultConfig } from './webpack.config'
import commonMeta from '../src/client/common.meta.json'

const config = coreConfigs[0]
config.output = {
  ...config.output,
  path: path.resolve('dist'),
  filename: 'bilibili-clear.user.js',
}
config.plugins.push(
  new webpack.SourceMapDevToolPlugin({
    filename: '[file].map',
    publicPath: 'https://raw.githubusercontent.com/NeverOvO/Bilibili-Clear/beta/dist/',
  }),
)
// Separate installable entry, with its own minimal grants and match scope.
const preloader = getDefaultConfig()
preloader.mode = 'production'
preloader.cache = { type: 'memory' }
preloader.entry = './src/client/home-preloader.ts'
preloader.output = {
  path: path.resolve('dist'),
  filename: 'bilibili-clear-home-preloader.user.js',
}
const preloaderMeta = {
  name: 'Bilibili Clear 首页预加载',
  namespace: 'https://github.com/NeverOvO/Bilibili-Clear',
  version: commonMeta.version,
  description: '配合 Bilibili Clear，尝试提前显示极简首页过渡层；需同时启用主脚本',
  author: 'NeverOvO',
  license: 'MIT',
  match: '*://www.bilibili.com/*',
  'run-at': 'document-start',
  grant: 'none',
  noframes: '',
  homepageURL: 'https://github.com/NeverOvO/Bilibili-Clear',
  updateURL:
    'https://raw.githubusercontent.com/NeverOvO/Bilibili-Clear/beta/dist/bilibili-clear-home-preloader.user.js',
  downloadURL:
    'https://raw.githubusercontent.com/NeverOvO/Bilibili-Clear/beta/dist/bilibili-clear-home-preloader.user.js',
}
preloader.plugins.push(
  new webpack.BannerPlugin({
    banner: `// ==UserScript==\n${Object.entries(preloaderMeta)
      .map(([key, value]) => `// @${key.padEnd(16, ' ')}${value}`)
      .join('\n')}\n// ==/UserScript==`,
    raw: true,
    entryOnly: true,
  }),
)
export default [config, preloader]
