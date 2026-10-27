import postcssPresetEnv from 'postcss-preset-env'
import autoPrefixer from 'autoprefixer'
import { RuleSetUseItem } from 'webpack'

// Keep style injection and css-loader on the same CommonJS interop convention.
export const styleLoader: RuleSetUseItem = {
  loader: 'style-loader',
  options: { esModule: false },
}
export const cssLoader: RuleSetUseItem = {
  loader: 'css-loader',
  options: {
    esModule: false,
  },
}
export const postCssLoader: RuleSetUseItem = {
  loader: 'postcss-loader',
  options: {
    postcssOptions: {
      plugins: [postcssPresetEnv(), autoPrefixer()],
    },
  },
}
export const sassLoader: RuleSetUseItem = {
  loader: 'fast-sass-loader',
  options: {
    includePaths: ['src/ui/'],
  },
}

export const cssStyleLoaders = [cssLoader, postCssLoader]
export const sassStyleLoaders = [cssLoader, postCssLoader, sassLoader]
