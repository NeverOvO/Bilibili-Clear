import commonMeta from '@/client/common.meta.json'
import distributionMeta from '@/client/bilibili-evolved.meta.json'

commonMeta.copyright = commonMeta.copyright.replace(
  /\[year\]/g,
  new Date().getFullYear().toString(),
)
/** 分支表 */
export const branches = {
  stable: 'master',
  stableCdn: 'master-cdn',
  preview: 'preview',
}
const compilationInfo = webpackCompilationInfo
/**
 * 脚本元数据
 */
export const meta = {
  /** 编译时数据 */
  compilationInfo,
  /** 名称 */
  name: GM_info.script.name,
  /** 描述 */
  description: GM_info.script.description,
  /** 原文件名 */
  get originalFilename(): string {
    return 'bilibili-clear.user.js'
  },
  /** 检查更新的链接 */
  get updateURL(): string {
    return distributionMeta.updateURL
  },
  /** 下载更新的链接 */
  get downloadURL(): string {
    return this.updateURL
  },
  ...commonMeta,
}
