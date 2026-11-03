import path from 'path'
import webpack from 'webpack'
import coreConfigs from './webpack.prod'

const config = coreConfigs[0]
config.output = {
  ...config.output,
  path: path.resolve('dist'),
  filename: 'bilibili-clear.user.js',
}
config.plugins.push(
  new webpack.SourceMapDevToolPlugin({
    filename: '[file].map',
    publicPath: 'https://raw.githubusercontent.com/NeverOvO/Bilibili-Clear/master/dist/',
  }),
)
export default config
