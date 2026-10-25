import { getDevClientOptions } from './options'

const options = getDevClientOptions()

export const urlConverter = {
  toDevUrl: (originalUrl: string, kind = 'component') => {
    if (!originalUrl || !['component', 'plugin'].includes(kind)) {
      return null
    }
    try {
      const parsed = new URL(originalUrl)
      const featureMatch = parsed.pathname.match(
        new RegExp(`/registry/dist/${kind}s/([\\w/-]+\\.js)$`),
      )
      if (featureMatch) {
        return `http://127.0.0.1:${options.port}/registry/dist/${kind}s/${featureMatch[1]}`
      }
      if (['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        const legacyMatch = parsed.pathname.match(new RegExp(`^/${kind}s/([\\w/-]+\\.js)$`))
        if (legacyMatch) {
          return `http://127.0.0.1:${options.port}/registry/dist/${kind}s/${legacyMatch[1]}`
        }
      }
    } catch {
      return null
    }
    return null
  },
}
