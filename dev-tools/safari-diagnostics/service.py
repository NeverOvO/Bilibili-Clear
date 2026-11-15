#!/usr/bin/env python3
"""Start/stop a finite Safari recorder as a temporary user launchd job."""

import argparse
from datetime import datetime
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import sys
import time
import uuid

from lifecycle import (CONTROL, LABEL, LOG_ROOT, collector_locked, current_status,
                       initialize, lock, process_start, read_json, redact, timestamp, write_json)


def launchctl(*arguments):
    return subprocess.run(["/bin/launchctl", *arguments], capture_output=True,
                          text=True, errors="replace", timeout=25)


def service_target():
    return "gui/" + str(os.getuid()) + "/" + LABEL


def save_launcher_error(directory, operation, message):
    write_json(directory / "launcher-error.json", {
        "at": timestamp(), "operation": operation, "message": redact(message)[:12000],
    })


def start(args):
    if collector_locked():
        raise RuntimeError("已有采集器持有运行锁；请先使用 status 或 stop。")
    # Remove an unloaded/finished previous registration, never a login item.
    loaded = launchctl("print", service_target())
    if loaded.returncode == 0:
        removed = launchctl("bootout", service_target())
        if removed.returncode:
            raise RuntimeError("旧任务无法移除：" + redact(removed.stderr)[:2000])

    run_id = datetime.now().strftime("safari-%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8]
    directory = LOG_ROOT / run_id
    directory.mkdir(mode=0o700)
    runtime = CONTROL / "runtime" / run_id
    runtime.mkdir(parents=True, mode=0o700)
    # These are the executable runtime, not backups of repository/user files.
    for filename in ("collect.py", "processes.py", "lifecycle.py"):
        destination = runtime / filename
        shutil.copyfile(Path(__file__).resolve().parent / filename, destination)
        destination.chmod(0o600)
    status = {"schema_version": 1, "state": "starting", "run_id": run_id,
              "started_at": timestamp(), "updated_at": timestamp(), "launch_mode": "launchd"}
    write_json(directory / "status.json", status)
    write_json(CONTROL / "latest.json", {"directory": str(directory), "run_id": run_id})
    plist = runtime / "job.plist"
    specification = {
        "Label": LABEL,
        "ProgramArguments": [str(Path(sys.executable).resolve()), "-u", "-B",
                             str(runtime / "collect.py"), "--duration", str(args.duration),
                             "--run-directory", str(directory), "--launch-mode", "launchd"],
        "WorkingDirectory": str(runtime),
        "EnvironmentVariables": {"LC_ALL": "C", "PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1"},
        "RunAtLoad": True,
        "KeepAlive": False,
        "ProcessType": "Background",
        "AbandonProcessGroup": False,
        "ExitTimeOut": 15,
        "Umask": 0o077,
        "HardResourceLimits": {"FileSize": 4 * 1024 * 1024},
        "StandardOutPath": str(directory / "launcher.stdout.log"),
        "StandardErrorPath": str(directory / "launcher.stderr.log"),
    }
    with plist.open("wb") as stream:
        plistlib.dump(specification, stream)
    plist.chmod(0o600)
    write_json(CONTROL / "job.json", {"run_id": run_id, "directory": str(directory),
                                     "runtime": str(runtime), "service": service_target()})
    try:
        result = launchctl("bootstrap", "gui/" + str(os.getuid()), str(plist))
        if result.returncode:
            raise RuntimeError(result.stderr or result.stdout or "launchctl bootstrap failed")
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        save_launcher_error(directory, "bootstrap", error)
        write_json(directory / "status.json", {**status, "state": "failed",
                   "updated_at": timestamp(), "reason": "launchd-bootstrap-failed"})
        raise RuntimeError("后台启动失败；详情见 " + str(directory / "launcher-error.json")) from error

    print("launchd 已接收临时采集任务，目录：" + str(directory), flush=True)
    # Bootstrap success is not collector readiness or proof of successful sampling.
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        observed = current_status()
        if observed.get("run_id") == run_id and observed["observed_state"] == "running":
            print("采集器已写入心跳；最多运行 " + str(args.duration) + " 秒。", flush=True)
            print("可关闭此终端。是否获得调用栈请查看 status 的 total_samples。", flush=True)
            return 0
        if observed.get("run_id") == run_id and observed.get("state") in ("failed", "finished"):
            raise RuntimeError("采集任务已结束，原因：" + str(observed.get("reason")) + "；目录：" + str(directory))
        time.sleep(0.4)
    inspection = launchctl("print", service_target())
    save_launcher_error(directory, "startup-not-ready",
                        (inspection.stdout + "\n" + inspection.stderr)[:12000])
    raise RuntimeError("已提交任务，但尚未收到有效心跳；不能确认正在采集。请运行 status，查看 " + str(directory))


def stop():
    observed = current_status()
    directory = Path(observed["directory"]) if observed.get("directory") else None
    if directory and directory.is_dir():
        (directory / "STOP").touch(mode=0o600, exist_ok=True)
    pid = observed.get("collector_pid")
    identity = observed.get("collector_start_time")
    # Never signal a stale/reused PID just because it appears in status.json.
    if observed["identity_matches"] and process_start(pid) == identity:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    loaded = launchctl("print", service_target())
    if loaded.returncode == 0:
        result = launchctl("bootout", service_target())
        if result.returncode:
            if directory:
                save_launcher_error(directory, "bootout", result.stderr)
            raise RuntimeError("launchd 未确认移除任务；请运行 status。")
    deadline = time.monotonic() + 20
    while collector_locked() and time.monotonic() < deadline:
        time.sleep(0.4)
    if collector_locked():
        raise RuntimeError("停止请求已发出，但采集器仍持有锁，不能报告已停止。")
    print("采集器已停止；临时 launchd 注册已移除。已有记录保留。")


def show_status():
    import json
    observed = current_status()
    loaded = launchctl("print", service_target())
    observed["launchd_registered"] = loaded.returncode == 0
    labels = {
        "running": "运行中（进程身份及近期心跳存在）",
        "stale": "记录已陈旧；status.json 的 running 不代表仍在运行",
        "unresponsive-recorder": "进程仍在，但采集器心跳超过 30 秒未更新",
        "unknown-active": "运行锁被占用，但不能确认进程身份",
        "finished": "已结束", "failed": "启动或运行失败", "not-started": "尚无运行记录",
    }
    observed["description"] = labels.get(observed["observed_state"], observed["observed_state"])
    print(json.dumps(observed, ensure_ascii=False, indent=2))
    if observed["observed_state"] in ("stale", "failed", "unknown-active") and observed.get("directory"):
        print("查看该目录的 launcher.stderr.log、launcher-error.json 和 errors.json；权限错误不会自动提升权限。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "stop", "status", "foreground"))
    parser.add_argument("--duration", type=int, default=600)
    args = parser.parse_args()
    if sys.platform != "darwin" or not 30 <= args.duration <= 3600:
        parser.error("需要 macOS；duration 范围为 30～3600 秒。")
    initialize()
    if args.action == "foreground":
        os.execv(sys.executable, [sys.executable, "-u", "-B", str(Path(__file__).with_name("collect.py")),
                                 "--duration", str(args.duration)])
    try:
        # Serialize start/stop requests; the collector owns a separate lifetime lock.
        with lock("control.lock"):
            if args.action == "start":
                return start(args)
            if args.action == "stop":
                stop()
            else:
                show_status()
        return 0
    except BlockingIOError:
        print("另一个启动/停止操作正在执行，请稍后重试。", file=sys.stderr)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        write_json(CONTROL / "last-command-error.json", {
            "at": timestamp(), "operation": args.action, "message": redact(error)[:12000],
        })
        print(redact(error), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
