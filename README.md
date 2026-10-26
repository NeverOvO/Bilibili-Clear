# Bilibili Clear · 哔哩清爽

一次安装，直接使用。Bilibili Clear 内置 37 项功能，覆盖首页、视频、动态、评论、直播和下载；每项功能都保留独立开关与选项。

由 [NeverOvO](https://github.com/NeverOvO) 维护，基于 [Bilibili Evolved](https://github.com/the1812/Bilibili-Evolved) 开发。当前分支：**beta · 3.2.0.1（Beta 1）**。

[安装](#安装) · [功能](#内置功能) · [迁移设置](#迁移已有设置) · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/NeverOvO/Bilibili-Clear/issues)

## Beta 体验

本分支开发关注首页与短视频模式，正式版仍在 [master](https://github.com/NeverOvO/Bilibili-Clear/tree/master)。Beta 安装链接与后续自动更新均指向 `beta`，不会向正式版用户推送测试功能。保持原脚本名称与设置存储；安装时选择覆盖现有 Bilibili Clear，避免同时启用两个副本。

- **原版精简**：保留现有首页和全部原功能，默认继续使用此模式。
- **关注极简**：首页上方切换；关注 UP 原创视频按天分组、横向封面网格展示，帖子使用独立时间线。只显示已确认关注的作者，不展示推荐、直播或转发。
- **观看标记**：实际播放进度与最近最多 90 条 B 站历史合并。封面显示继续观看位置，有明确完成记录才显示灰色“看完了”印章；多 P 逐段记录。本地最多保存 1000 条，未命中记录不代表没有看过。
- **短视频**：上方按钮打开，以网页推荐源和官方播放器逐条播放。播放器外可使用上下键、滚轮和上下滑动，也可点击上一条 / 下一条。原生播放器内部保留自己的操作。
- **内容过滤**：过滤广告卡、直播和番剧，并通过分类、标题和标签排除可识别的短剧。无标记的植入广告或短剧不能保证全部识别，可手动屏蔽 UP。历史和屏蔽列表按登录账号存储在脚本管理器中。

接口和登录体验交由 Beta 用户实际测试；本次不执行自动化检查或浏览器验证。普通视频页本地记录与官方嵌入播放器的历史同步是两种来源，短视频退出后可点“同步观看记录”。全部数据请求使用当前账号权限，接口报错会显示重试入口，不以其他推荐内容代替关注列表。

要回到正式版，安装 [master 版本](https://raw.githubusercontent.com/NeverOvO/Bilibili-Clear/master/dist/bilibili-clear.user.js)，在脚本管理器中确认覆盖较高版本；正式版自动更新地址也随之恢复。现有功能设置继续沿用，Beta 新增项在正式版中不启用。

## 安装

在桌面浏览器中安装脚本管理器后，打开以下链接并完成安装：

**[安装 Bilibili Clear](https://raw.githubusercontent.com/NeverOvO/Bilibili-Clear/beta/dist/bilibili-clear.user.js)**

安装后刷新哔哩哔哩页面。点击左下角的 Bilibili Clear 按钮打开设置窗口，按分类搜索功能、调整开关和选项，或导入设置，无需逐个下载组件。窗口中的“页面功能”集中显示当前页面可用的操作。可通过关闭按钮、Esc 或点击背景遮罩关闭窗口。

已安装 Bilibili Clear 3.x 的用户可通过 Beta 链接覆盖更新，现有设置继续沿用，无需重新导入。

从 Bilibili Evolved 或 HomeFix 切换时，请先关闭旧脚本，避免同时修改同一页面。安装不同名称的脚本不会自动转移旧脚本的存储数据。

## 内置功能

| 范围 | 功能 |
| --- | --- |
| 首页与顶栏 | 关注首页与短视频（Beta）、自定义顶栏、简化首页、删除广告、隐藏直播推荐、屏蔽黑名单 UP 主 |
| 视频与播放器 | 快捷键扩展、删除视频弹窗、隐藏视频推荐、隐藏视频标题层、展开视频简介、禁用特殊弹幕样式、禁止滚轮调音量 |
| 动态与评论 | 展开动态内容、动态反折叠、禁止跳转动态详情、复制动态链接、删除动态、简化评论区、快速收起评论、评论区 IP 属地显示 |
| 直播 | 直播弹幕发送栏、自动收起直播侧栏、删除直播水印、简化直播间、隐藏直播马赛克、直播全屏包裹、一键点亮直播间粉丝勋章 |
| 下载与工具 | 下载视频、下载音频、下载弹幕、下载字幕、下载表情、查看封面、专栏复制优化、关注时间显示、签到助手 |

设置面板另内置“最近使用”分类。功能定义见 [内置清单](src/core/distribution-manifest.json)。

## 使用说明

- 默认启用内置功能，按页面范围运行；无需使用的功能可在设置中关闭。
- 首页删除广告功能同时隐藏“检测到您的页面展示可能受到浏览器插件影响”的提示横幅。
- “简化首页”中的“推荐视频流”控制新版首页整片推荐内容；轮播图有独立开关。
- 删除动态、签到、下载、点亮粉丝勋章等功能由用户点击触发，安装脚本不会自动执行这些操作。
- 下载和账号功能使用当前账号已有权限，受登录状态、内容权限和平台接口限制。
- 额外扩展接口继续保留。项目自带功能随本体更新，不能通过外部组件覆盖；额外扩展自行维护来源。

## 迁移已有设置

支持导入 Bilibili Evolved v2、HomeFix 和 Bilibili Clear 导出的设置文件。

1. 在旧脚本中导出设置。
2. 关闭旧脚本，从本页安装 Bilibili Clear。
3. 打开设置面板中的“关于”，选择“导入设置”。
4. 导入完成后刷新页面。原功能开关、布局、快捷键及个人设置会迁移到新版本。

迁移使用原功能 ID，将已内置组件的设置移入内置存储，并移除这些组件的旧代码和独立更新记录。配置结构不符合要求时会显示具体字段错误，不先覆盖现有设置。

也可以在本地转换文件，原文件不会被覆盖：

```sh
node dev-tools/migrate-settings.mjs --input /path/to/settings-homefix.json --output /path/to/settings-bilibili-clear.json
```

个人设置文件可能包含黑名单、收藏夹状态及额外扩展信息，请勿提交到公开仓库。公开发行版只包含通用功能与布局默认值。

## 更新与回退

本体及 37 项内置功能由本仓库统一发布，通过脚本管理器获取更新。上游改动经过选择性合并后进入新版本，不会直接覆盖当前内置功能。

每个正式版本提供 Git tag、[Release](https://github.com/NeverOvO/Bilibili-Clear/releases)、更新说明和安装文件。需要回退时，按[回退指南](doc/rollback.md)操作。

B 站页面结构和接口变化可能影响功能。反馈时请提供页面地址、脚本版本、浏览器及脚本管理器版本、具体操作与错误信息；不要提交 Cookie、Token 或完整个人配置。

## 浏览器与脚本管理器

面向桌面端 Chromium / Firefox / Safari，以及 Tampermonkey、Violentmonkey、Stay。Safari / Stay 的组件加载接收者问题已作兼容处理，不同组合的功能表现仍取决于浏览器和脚本管理器能力。

3.2.0.1 Beta 提供发布构建；本次交付未执行自动化测试、类型检查、lint 或安装后的浏览器回归。移动端不在当前适配范围。

## 开发

使用 Node.js 22 和项目指定的 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm --dir registry install --frozen-lockfile
pnpm run build
```

输出为 `dist/bilibili-clear.user.js`，全部默认功能随安装包交付。业务实现继续位于 `registry/lib`，核心和设置框架位于 `src`。新增功能通过内置清单、加载入口和必要迁移接入。

开发与贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，本地调试见 [DevServer 文档](dev-tools/dev-server/README.md)。

## 来源与许可

保留 Bilibili Evolved 的 Git 历史、原作者及组件贡献者署名。源码许可与附加再发布条件见 [LICENCE.md](LICENCE.md)，来源说明见 [NOTICE.md](NOTICE.md)。Bilibili Clear 的问题反馈、版本发布和后续维护由本仓库承担。

感谢 Bilibili Evolved 及 Vue、Lodash、fflate、protobufjs、Tippy.js、Popper、Sortable、StreamSaver 等开源项目。

## 支持项目

如果 Bilibili Clear 对你有帮助，可以通过微信或支付宝自愿赞助，支持后续维护。赞助不影响功能使用。

| 微信 | 支付宝 |
| --- | --- |
| <img src="images/support/wechat.jpg" alt="NeverOvO 微信赞助码" width="280"> | <img src="images/support/alipay.png" alt="NeverOvO 支付宝赞助码" width="280"> |
