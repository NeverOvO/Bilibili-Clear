# Bilibili Clear 发布流程

1. 正式版在 `master`、测试版在 `beta` 完成源码改动，更新 `src/client/common.meta.json` 的产品版本与 `CHANGELOG.md`。
2. 外部扩展所需 API 兼容基线由 `src/core/distribution-manifest.json` 的 `compatibilityVersion` 管理，不随产品版本自动提升。
3. 提交源码后运行 `pnpm run build`，生成本体和 source map；将产物提交到同一发布分支。
4. 创建与本体版本对应的 `v版本号` tag，并发布 GitHub Release，附上本次更新说明和两个构建文件。
5. 只有明确完成的浏览器或自动化检查才能写入发布记录；未执行的检查按实际状态说明。

GitHub Actions 的 Build 工作流为手动构建，只上传附件，不自动提交或发布。PR 面向 `master`，检查源码和构建；发布产物通过维护者发布流程提交。

Beta 使用四段数字版本（当前 3.2.0.8）兼容已有更新比较逻辑，更新与 source map 地址指向 `beta`。以 prerelease 发布，不设为 latest，不合入 `master`。切回正式版需手动安装 master 脚本并允许覆盖较高版本。

3.2.0.8 Beta 8（2026-10-27）隐藏完成视频的封面稍后再看按钮，保留批量手动选择；网页完整原标题末尾只追加一个 Clear，下载命名使用未标记标题。本轮静态审计覆盖竖屏错误恢复、封面等待与导航意图、帖子摘要补齐、原生抽奖加载状态、分 P 上下文重试、稍后再看旧快照和近似归并完整性，具体见 [Beta 8 审计记录](beta8-audit.md)。

本轮进行源码静态审计，发布使用统一构建流程；未执行测试、类型检查、lint 或浏览器实测。发布构建不等同于功能实测，实际构建结果随发布记录填写。
