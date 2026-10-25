const homefixComponents = new Set([
  'style/simplify/home.js',
  'style/custom-navbar.js',
  'utils/remove-promotions.js',
  'style/hide/video/recommended-live.js',
])

/** 仅将上游发布的首页修复组件定向到 HomeFix, 保留其他组件和自定义来源. */
export const getHomefixFeatureUrl = (url: string): string => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return url
  }
  let match: RegExpMatchArray | null = null
  if (parsed.hostname === 'raw.githubusercontent.com') {
    match = parsed.pathname.match(
      /^\/the1812\/Bilibili-Evolved\/(?:master|preview|master-cdn)\/registry\/dist\/components\/(.+\.js)$/,
    )
  } else if (parsed.hostname === 'cdn.jsdelivr.net') {
    match = parsed.pathname.match(
      /^\/gh\/the1812\/Bilibili-Evolved@(?:master|preview|master-cdn)\/registry\/dist\/components\/(.+\.js)$/,
    )
  }
  const path = match?.[1]
  if (!homefixComponents.has(path)) {
    return url
  }
  return `https://raw.githubusercontent.com/NeverOvO/Bilibili-Evolved-HomeFix/master/registry/dist/components/${path}`
}
