import { monkey } from '@/core/ajax'
import { DownloadPackage } from '@/core/download'

const imageExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/** Download only the cover supplied by the feed, using the project's file-saving mechanism. */
export const downloadVideoCover = async (cover: string, title: string, bvid: string) => {
  let url: URL
  try {
    url = new URL(cover, 'https://www.bilibili.com')
  } catch {
    throw new Error('封面地址无效，请刷新动态后重试。')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !/(^|\.)(hdslb\.com|bilibili\.com)$/.test(url.hostname)) {
    throw new Error('封面地址不可用，请刷新动态后重试。')
  }
  url.protocol = 'https:'
  // Bilibili image resizing suffixes describe a thumbnail; keep the original image path.
  url.pathname = url.pathname.split('@')[0]
  const blob = await monkey<Blob>({
    url: url.href,
    method: 'GET',
    responseType: 'blob',
    anonymous: true,
    timeout: 20_000,
  })
  if (!blob || !Number.isFinite(blob.size) || blob.size <= 0) {
    throw new Error('封面文件为空，请重试。')
  }
  const mime = (blob.type || '').split(';')[0].toLowerCase()
  const pathExtension = url.pathname.match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1].toLowerCase()
  const extension = imageExtensions[mime] ||
    ((!mime || mime === 'application/octet-stream') && pathExtension)
  if (!extension) {
    throw new Error('返回内容不是可下载的封面图片，请重试。')
  }
  const filename = `${bvid} - ${(title || '视频封面').slice(0, 60)}.${extension === 'jpeg' ? 'jpg' : extension}`
  await DownloadPackage.single(filename, blob)
}
