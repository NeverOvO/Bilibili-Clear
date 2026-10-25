# Bilibili Clear 发布流程

1. 在 `master` 完成源码改动，更新 `src/client/common.meta.json` 的产品版本与 `CHANGELOG.md`。
2. 外部扩展所需 API 兼容基线由 `src/core/distribution-manifest.json` 的 `compatibilityVersion` 管理，不随产品版本自动提升。
3. 提交源码后运行 `pnpm run build`，生成本体和 source map；将产物提交到同一发布分支。
4. 创建与本体版本对应的 `v版本号` tag，并发布 GitHub Release，附上本次更新说明和两个构建文件。
5. 只有明确完成的浏览器或自动化检查才能写入发布记录；未执行的检查按实际状态说明。

GitHub Actions 的 Build 工作流为手动构建，只上传附件，不自动提交或发布。PR 面向 `master`，检查源码和构建；发布产物通过维护者发布流程提交。
