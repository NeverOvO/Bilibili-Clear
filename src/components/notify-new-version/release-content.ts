export const getReleaseContent = async (version: string) => {
  const { monkey } = await import('@/core/ajax')
  const { default: marked } = await import('marked')

  try {
    const api = `https://api.github.com/repos/NeverOvO/Bilibili-Evolved-HomeFix/releases/tags/v${version}`
    const result = JSON.parse(await monkey({ url: api }))
    const content = result?.body ?? ''
    return marked(content as string)
  } catch (error) {
    return `检查更新时发生错误: ${error.message}`
  }
}

export const getUpdateUrl = async () => {
  const { meta } = await import('@/core/meta')
  return meta.updateURL
}

export const showReleaseContent = async (content: string) => {
  const { showDialog } = await import('@/core/dialog')
  const updateUrl = await getUpdateUrl()
  showDialog({
    title: '更新说明',
    content: () => import('./ReleaseContent.vue'),
    contentProps: {
      content,
      updateUrl,
    },
  })
}
