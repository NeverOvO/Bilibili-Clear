# Beta 8 修改代码审计

版本：3.2.0.8 · 日期：2026-10-27

本次对关注首页、竖屏播放器、帖子解析、抽奖弹窗、观看进度、稍后再看及网页标题处理进行源码静态审计。共定位并修复 8 个 P2 问题和 1 个 P3 边界问题，同时完成已看完视频按钮和标题后缀的调整。审计结论基于代码路径和调用关系，不代表浏览器实测结果。

## 本轮行为调整

- 已达到完成规则的视频隐藏封面右上角的单条稍后再看按钮；批量模式仍可手动勾选。已在稍后再看中的条目继续只显示状态文字，按天添加仍只包含当前已加载的未完成视频。
- 网页标题保留完整原文，只在末尾追加 ` Clear`。空标题不单独生成 `Clear`；原生标题变化后同步处理，卸载时仅恢复脚本自身写入的标题。下载命名读取未加后缀的原始标题。

## 发现与修复

| 优先级 | 问题与影响 | 修复方式 | 代码 |
| --- | --- | --- | --- |
| P2 | 原生播放器曾报错，随后已实际播放，外层错误遮罩仍可能保留。 | 只有当前所属视频触发真实 `playing` 事件才清除可恢复错误；页面或分 P 已切换的终止错误保留。 | [native-player.ts](../registry/lib/components/style/clear-home/native-player.ts) |
| P2 | 首次封面一直等到播放才撤下，可能挡住原生登录、权限或网络提示。 | 封面等待最多 3 秒；播放、错误或手势提示提前撤下。已显示原生界面时保留其操作入口，无播放器容器才进入启动超时。 | [ShortsView.vue](../registry/lib/components/style/clear-home/ShortsView.vue)、[native-player.ts](../registry/lib/components/style/clear-home/native-player.ts) |
| P2 | 队尾等待推荐时点击上一条，先前的下一条请求可能在返回后再次跳转。 | 跳转意图与补充推荐请求独立；返回、屏蔽、重载、隐藏或离开时使旧意图失效，旧异步回调不能覆盖新操作。 | [ShortsView.vue](../registry/lib/components/style/clear-home/ShortsView.vue) |
| P2 | 动态接口返回非空摘要就被视作完整正文，长帖无法继续补齐。 | 仅明确的完整段落数据可标记完成；摘要继续读取同一原帖的 Opus 数据，失败保留已有内容及重试入口，权限受限内容不标记完整。 | [following.ts](../registry/lib/components/style/clear-home/following.ts) |
| P2 | 抽奖 iframe 触发加载事件后即视为成功，原生应用未渲染时可能永久空白。 | 等待官方结果组件出现；空应用和加载动画继续保留 20 秒超时，明确错误进入重试状态。关闭时释放观察器与 iframe。 | [native-lottery.ts](../registry/lib/components/style/clear-home/native-lottery.ts) |
| P2 | 正文尚未补全的帖子可能因作者和图片相同而被错误合并。 | 相似归并要求双方正文完整，动态 ID 去重和营销标记规则保留。 | [post-filter.ts](../registry/lib/components/style/clear-home/post-filter.ts) |
| P2 | 视频分 P 信息首次请求失败后，同一视频不再尝试记录本地进度。 | 初次失败后最多再重试 3 次，等待间隔为 1、3、8 秒；账号、视频变化或卸载时取消请求和计时器，不修改真实播放时间。 | [progress.ts](../registry/lib/components/style/clear-home/progress.ts) |
| P2 | 稍后再看的旧读取结果晚于添加操作返回，可能清除共享缓存中刚添加的状态。 | 每个在途读取临时保存期间成功添加的条目，返回时合并到共享缓存，保留接口快照与原有顺序，请求结束即释放临时集合。 | [watchlater.ts](../registry/lib/components/style/clear-home/watchlater.ts) |
| P3 | 页面复用已标记标题并将 `(1)` 一类通知计数替换为 `(2)` 时，可能重复追加后缀。这是静态推导的边界路径，未确认主站实际采用该更新方式。 | 对比去除首部数字计数后的已知标题，仅去掉已确认属于脚本的后缀；保留新的计数与原标题。 | [page-title.ts](../src/core/page-title.ts) |

## 审计范围与边界

审计阅读了上述文件及 `VideoTile.vue`、`FollowingFeed.vue`、`ClearHome.vue`、`PostDay.vue`、`LotteryDialog.vue`、推荐加载、进度共享生命周期、相关样式和核心标题格式化的调用关系，重点检查请求竞态、账号切换、取消与卸载、缓存回写、媒体所属关系、完整正文判定和按钮条件。

抽奖入口仍限制为同源官方地址，参与由原生页面中的用户操作完成。观看进度仍按账号保存；完成遮罩与真实时间独立。封面下载入口保持隐藏，组件及配置标识保持兼容。

本次提供统一发布构建，未运行自动化测试、类型检查、lint 或浏览器实测。第三方接口和原生页面可能变化；Safari / Stay 中的播放、抽奖交互和页面样式仍需安装体验。本次未对全部上游组件或第三方依赖开展全面安全审计，也不将构建成功等同于运行时功能通过。
