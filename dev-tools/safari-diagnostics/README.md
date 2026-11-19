# Safari 卡死外部采集器

macOS 临时诊断工具，需要 Python 3.8 或更高版本，只使用系统工具和 Python 标准库。采集在 Safari 网页进程之外运行，不上传记录，不修改用户脚本，不要求 sudo。

## 双击启动

解压后保持整个文件夹完整，双击 `start.command`。默认采集 10 分钟，之后自动结束。使用 Safari 复现问题时，可以关闭启动它的终端窗口。

- `start.command`：提交一次有时限的后台采集。
- `status.command`：读取实际运行状态、心跳、已取得的调用栈数量和记录目录。
- `stop.command`：停止当前采集并移除临时任务，保留已有记录。

`start` 提示“launchd 已接收”只表示任务提交成功；提示“采集器已写入心跳”表示已观察到该次进程的近期心跳。`status` 中 `total_samples` 大于 0 才表示已经取得原生调用栈，不能把提交成功当作采样成功。

后台任务通过当前登录用户的 launchd 启动。运行脚本安装到 `~/Library/Application Support/Bilibili-Clear/SafariDiagnostics/runtime/`，不依赖原来的仓库目录持续可读。临时 plist 不写入 `LaunchAgents`，没有 `KeepAlive`，不会在下次登录时自动启动。已退出任务的注册可通过 `stop` 或下一次 `start` 清理。

## 命令行

在本工具文件夹内执行：

```sh
python3 -B service.py start
python3 -B service.py status
python3 -B service.py stop
```

可指定本次后台窗口长度，范围 30～3600 秒：

```sh
python3 -B service.py start --duration 600
```

需要在终端前台观察输出时：

```sh
python3 -u -B service.py foreground
```

前台与后台共用运行锁，同一用户仅允许一个新版采集器运行。前台按 Ctrl+C 停止；关闭前台终端会结束该模式。后台使用 `stop` 停止。直接运行 `collect.py` 仍是前台模式，原有 `--duration`、`--keep-seconds`、`--sample-interval` 参数保留。

## 记录内容

每秒记录已识别进程的 CPU、RSS、PID 和启动时间。通过 Safari 自身的系统日志识别 WebContent/GPU；不把其他应用的 WebKit 进程直接当成 Safari 进程。启动时异步读取最近 30 分钟的归属信息，最多读取 30 秒、16 MiB；后续日志继续补充识别。

WebContent 调用栈串行采样，每次持续 1 秒，采样间隔 10 毫秒，同一进程两次采样至少相隔 5 秒。进程较多或符号解析较慢时，实际间隔会变长。保留最近 120 秒的调用栈；Safari 明确报告 `unresponsive` 后继续记录 15 秒并停止。普通进程退出只记事件，不直接判断为崩溃。

记录位于 `~/Library/Logs/Bilibili-Clear/safari-日期-时间-标识/`：

- `status.json`：采集器状态、进程身份、心跳、样本数量和警告。
- `events.json`、`metrics.json`：结构化事件和近期 CPU/RSS，不保存完整系统日志消息。
- `samples/*.txt`：原生线程调用栈。
- `errors.json`：系统日志、采样命令和采集器的限量错误信息。
- `launcher.stdout.log`、`launcher.stderr.log`：后台入口的输出与异常。
- `launcher-error.json`：任务提交或启动就绪失败的诊断信息，发生此类错误时生成。

使用 `status` 判断是否仍在采集；不要只看某个旧 `status.json` 的 `state: running`。状态入口会结合运行锁、PID 启动时间和心跳：锁已释放的旧 `running` 显示为陈旧记录，进程仍在但 30 秒未更新心跳会明确显示异常。无法确认身份时不会向旧 PID 发送停止信号。

## 权限、限量与边界

本工具的运行目录权限为 `0700`，记录和配置为 `0600`。后台运行的权限环境可能与终端不同；遇到 macOS 权限限制时，错误会保存在上述文件中，不自动提权或修改系统隐私设置。提交前的入口错误还会保存在 Application Support 控制目录的 `last-command-error.json`。

调用栈单文件上限 4 MiB，当前窗口滚动保留，单次运行预算约 64 MiB；后台标准输出与错误各有 4 MiB 上限。事件、指标与错误条数也有限额。只清理本次运行生成的滚动样本；已结束的记录和 runtime 文件留在本机，可在采集停止后按需删除。

调用栈和错误文本会替换用户主目录与 HTTP(S) 地址，但这不是完整匿名化保证，分享前仍需查看。工具不采集完整内存、Cookie、网页正文或账户配置。

原生调用栈可用于区分 JavaScript 执行、布局绘制、锁和进程通信等待，未必能直接对应用户脚本行号。一个 WebContent 可能承载多个标签；采到它的卡顿不等于确认 Bilibili Clear 是原因。RSS 不能单独证明内存压力，固定周期可能漏掉短暂卡顿，采样本身也有开销。页面侧日志仍可用于对齐操作时间。
