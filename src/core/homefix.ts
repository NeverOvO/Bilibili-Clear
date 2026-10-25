import manifest from './distribution-manifest.json'

/** Resolve only known project distribution URLs; third-party and local sources stay independent. */
export const getBundledFeatureForUrl = (url: string) => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return undefined
  }
  const repositories = new Set([
    'the1812/Bilibili-Evolved',
    'NeverOvO/Bilibili-Evolved-HomeFix',
    manifest.repository,
  ])
  let match: RegExpMatchArray | null = null
  if (parsed.hostname === 'raw.githubusercontent.com') {
    match = parsed.pathname.match(
      /^\/([^/]+\/[^/]+)\/(?:master|preview|master-cdn)\/registry\/dist\/(components|plugins)\/(.+)\.js$/,
    )
  } else if (parsed.hostname === 'cdn.jsdelivr.net') {
    match = parsed.pathname.match(
      /^\/gh\/([^/]+\/[^/]+)@(?:master|preview|master-cdn)\/registry\/dist\/(components|plugins)\/(.+)\.js$/,
    )
  }
  if (!match || !repositories.has(match[1])) {
    return undefined
  }
  const kind = match[2] as 'components' | 'plugins'
  const feature = manifest[kind].find(item => item.id === match[3])
  return feature ? { ...feature, kind } : undefined
}
