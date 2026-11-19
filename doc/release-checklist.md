# Bilibili Clear 发布流程

1. 在发布分支完成源码修改，更新 `src/client/common.meta.json` 的产品版本与 `CHANGELOG.md`。正式版版本号必须大于已公开的所有测试版。
2. 正式版的 manifest、脚本更新和下载地址、图标与 source map 均指向 `master`；测试版统一指向 `beta`，GitHub Release 标记为 prerelease。
3. 保留 `Bilibili Clear` 脚本名称和功能 ID。外部扩展的 API 兼容基线由 manifest 的 `compatibilityVersion` 管理，不随产品版本自动提升。
4. 审计发布改动，执行类型检查、全仓 lint、回归测试、依赖风险核对与生产构建，记录实际完成的检查及剩余限制。检查失败时先修复。
5. 提交源码后运行 `pnpm run build`，生成本体和 source map；将产物另行提交到同一分支，使内嵌构建信息能定位源码。
6. 创建对应版本 tag，发布 GitHub Release，附上更新说明、脚本和 source map；核对远端分支、tag 与附件。

4.1.3 将 4.1.2 Beta 1 至 Beta 5 的改动发布到 `master`。脚本、source map 和可选的 macOS Safari 采集器随正式版发布。Beta 5 用户可通过正式版链接覆盖安装并切换更新渠道。

4.1.3 的检查范围和本轮修复见 [发布审计记录](release-4.1.3-audit.md)。GitHub Actions 的 Build 工作流由人工触发，PR 工作流独立执行。
