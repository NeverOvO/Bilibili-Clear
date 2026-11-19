#!/usr/bin/env python3
"""A finite, local Safari flight recorder. No browser automation or dependencies."""

import argparse
from collections import deque
from datetime import datetime
import json
import os
from pathlib import Path
import queue
import re
import signal
import subprocess
import sys
import threading
import time
import traceback

from processes import parse_safari_event, snapshot_processes
from lifecycle import (CONTROL, initialize, lock, process_start, read_json, redact,
                       write_json)


PREDICATE = (
    'process == "Safari" AND ('
    'eventMessage CONTAINS "WebProcessProxy" OR '
    'eventMessage CONTAINS "GPUProcessProxy" OR '
    'eventMessage CONTAINS "WebContent[" OR '
    'eventMessage CONTAINS[c] "unresponsive" OR '
    'eventMessage CONTAINS "processDidTerminate")'
)
SAMPLE_LIMIT = 4 * 1024 * 1024
DISK_LIMIT = 64 * 1024 * 1024


def now():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def epoch(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError, TypeError):
        pass
    # The macOS log format uses +0800, which older Python fromisoformat rejects.
    for format_string in ("%Y-%m-%d %H:%M:%S.%f%z", "%Y-%m-%d %H:%M:%S%z", "%a %b %d %H:%M:%S %Y"):
        try:
            return datetime.strptime(value, format_string).timestamp()
        except (ValueError, TypeError):
            continue
    return None


class Recorder:
    def __init__(self, args):
        self.args = args
        self.started = time.monotonic()
        self.started_at = now()
        self.directory = args.run_directory or args.output.expanduser() / (
            datetime.now().strftime("safari-%Y%m%d-%H%M%S-") + str(os.getpid())
        )
        self.directory.mkdir(parents=True, mode=0o700, exist_ok=bool(args.run_directory))
        self.directory.chmod(0o700)
        self.run_id = self.directory.name
        self.collector_start_time = process_start(os.getpid())
        self.samples_dir = self.directory / "samples"
        self.samples_dir.mkdir(mode=0o700)
        self.stop = threading.Event()
        self.events = deque(maxlen=3000)
        self.metrics = deque(maxlen=240)
        self.identities = {}
        self.owned = {}
        self.processes = {}
        self.references = {}
        self.last_sample = {}
        self.failures = {}
        self.samples = deque()
        self.messages = queue.Queue(maxsize=2000)
        self.jobs = queue.Queue(maxsize=1)
        # Only one sample can be in flight. Its completion cannot be dropped with logs.
        self.sample_results = queue.Queue(maxsize=1)
        self.busy = False
        self.incident = None
        self.incident_at = None
        self.log_process = None
        self.log_thread = None
        self.worker = None
        self.discovery_process = None
        self.discovery_started = None
        self.children = set()
        self.children_lock = threading.Lock()
        self.errors = deque(maxlen=40)
        self.reason = "duration-complete"
        self.warning_counts = {}
        self.sample_count = 0
        self.env = {**os.environ, "LC_ALL": "C"}
        write_json(CONTROL / "latest.json", {"directory": str(self.directory), "run_id": self.run_id})

    def spawn(self, command, **options):
        # Stay in launchd's process group; launchd reaps it if this recorder dies.
        with self.children_lock:
            if self.stop.is_set():
                raise RuntimeError("collector-stopping")
            child = subprocess.Popen(command, env=self.env, **options)
            self.children.add(child)
        return child

    def terminate_child(self, child):
        if child.poll() is None:
            try:
                child.terminate()
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=3)
            except ProcessLookupError:
                pass
        with self.children_lock:
            self.children.discard(child)

    def read_stderr(self, child, operation):
        for line in child.stderr:
            self.enqueue(("error", {"at": now(), "operation": operation,
                                    "message": redact(line.strip())[:2000]}))

    def report_error(self, operation, error):
        self.errors.append({"at": now(), "operation": operation,
                            "message": redact(error)[:6000]})
        write_json(self.directory / "errors.json", list(self.errors))

    def record(self, event, **detail):
        self.events.append({"at": now(), "event": event, **detail})

    def warn(self, kind):
        self.warning_counts[kind] = self.warning_counts.get(kind, 0) + 1
        if self.warning_counts[kind] <= 3:
            self.record("warning", kind=kind)
            print("Warning: " + kind, flush=True)

    def enqueue(self, item):
        try:
            self.messages.put_nowait(item)
        except queue.Full:
            # Drop excess input rather than blocking log stream or growing memory.
            pass

    def read_stream(self, child, historical=False):
        consumed = 0
        try:
            for line in child.stdout:
                if self.stop.is_set():
                    break
                consumed += len(line)
                if historical and consumed > 16 * 1024 * 1024:
                    self.enqueue(("warning", "Initial Safari discovery reached its 16 MiB read limit"))
                    self.terminate_child(child)
                    break
                try:
                    event = parse_safari_event(json.loads(line))
                    if event:
                        self.enqueue(("historical-event" if historical else "event", event))
                except (ValueError, TypeError, KeyError):
                    continue
        finally:
            if not historical and not self.stop.is_set():
                self.enqueue(("warning", "Safari log stream ended; native sampling continues"))

    def start_log_stream(self):
        self.log_process = self.spawn(
            ["/usr/bin/log", "stream", "--style", "ndjson", "--level", "info",
             "--predicate", PREDICATE],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            errors="replace", bufsize=1,
        )
        self.log_thread = threading.Thread(target=self.read_stream, args=(self.log_process,), daemon=True)
        self.log_thread.start()
        threading.Thread(target=self.read_stderr, args=(self.log_process, "log-stream"), daemon=True).start()

    def discover_existing(self):
        # Read a bounded historical window solely to map current Safari-owned PIDs.
        # Historical unresponsive events never trigger this recording.
        try:
            self.discovery_process = self.spawn(
                ["/usr/bin/log", "show", "--last", "30m", "--style", "ndjson",
                 "--info", "--predicate",
                 'process == "Safari" AND (eventMessage CONTAINS "WebProcessProxy" OR eventMessage CONTAINS "GPUProcessProxy")'],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace",
            )
            self.discovery_started = time.monotonic()
            threading.Thread(target=self.read_stream, args=(self.discovery_process, True), daemon=True).start()
            threading.Thread(target=self.read_stderr, args=(self.discovery_process, "initial-discovery"), daemon=True).start()
        except OSError as error:
            self.report_error("initial-discovery", error)
            self.warn("Initial Safari process discovery unavailable")

    def accept_event(self, event, historical=False):
        event_time = epoch(event.get("timestamp"))
        for target in event.get("targets", []):
            pid = target["pid"]
            ref = {**target, "seen_at": event_time, "safari_pid": event.get("safari_pid")}
            previous = self.references.get(pid, {})
            if (previous.get("seen_at") or 0) <= (event_time or 0):
                self.references[pid] = ref
        if historical:
            return
        self.record("safari-" + event.get("event", "reference"), detail=event)
        # Normal page navigation/process retirement must not stop a recording.
        if event.get("event") == "unresponsive" and self.incident is None:
            self.incident = event
            self.incident_at = time.monotonic()
            print("Unresponsive Safari process detected; retaining pre/post incident data.", flush=True)

    def update_processes(self):
        try:
            self.processes = snapshot_processes()
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            self.warn("Process metrics unavailable")
            return
        previous = self.owned
        owned = {}
        for pid, ref in list(self.references.items()):
            proc = self.processes.get(pid)
            if not proc:
                continue
            started = epoch(proc["start_time"])
            seen = ref.get("seen_at")
            # ps lstart has whole-second resolution; logs identify the owning Safari.
            if started is None or seen is None or seen + 1 < started:
                continue
            expected = "com.apple.WebKit.WebContent" if ref["kind"] == "webcontent" else "com.apple.WebKit.GPU"
            if Path(proc["comm"]).name != expected:
                continue
            identity = str(pid) + ":" + proc["start_time"]
            owned[pid] = {**proc, "kind": ref["kind"], "identity": identity}
            if identity not in self.identities:
                self.identities[identity] = {**owned[pid], "first_seen_at": now()}
                self.record("target-discovered", pid=pid, kind=ref["kind"], start_time=proc["start_time"])
                print("Following Safari " + ref["kind"] + " PID " + str(pid), flush=True)
        for pid, proc in previous.items():
            if pid not in owned or owned[pid]["identity"] != proc["identity"]:
                self.record("target-exited", pid=pid, start_time=proc["start_time"])
        self.owned = owned
        rows = [{k: p[k] for k in ("pid", "kind", "start_time", "cpu_percent", "rss_kb")} for p in owned.values()]
        for p in self.processes.values():
            if Path(p["comm"]).name == "Safari":
                rows.append({**{k: p[k] for k in ("pid", "start_time", "cpu_percent", "rss_kb")}, "kind": "safari"})
        self.metrics.append({"at": now(), "processes": rows})

    def sample_worker(self):
        while not self.stop.is_set():
            try:
                proc = self.jobs.get(timeout=0.5)
            except queue.Empty:
                continue
            stamp = datetime.now().strftime("%H%M%S-%f")
            filename = stamp + "-pid-" + str(proc["pid"]) + ".txt"
            partial = self.samples_dir / (filename + ".partial")
            path = self.samples_dir / filename
            began = time.monotonic()
            result = {"pid": proc["pid"], "identity": proc["identity"], "at": now()}
            try:
                current = snapshot_processes().get(proc["pid"])
                if not current or current["start_time"] != proc["start_time"]:
                    result["error"] = "process-exited-before-sample"
                else:
                    # Apply a file-size limit in a fresh interpreter, avoiding
                    # preexec_fn (unsafe when the parent has other threads).
                    capture = self.spawn(
                        [sys.executable, "-c",
                         "import os,resource,sys; resource.setrlimit(resource.RLIMIT_FSIZE, "
                         + repr((SAMPLE_LIMIT, SAMPLE_LIMIT)) + "); os.execv(sys.argv[1], sys.argv[1:])",
                         "/usr/bin/sample", str(proc["pid"]), "1", "10", "-mayDie", "-file", str(partial)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                        text=True, errors="replace",
                    )
                    try:
                        _, sample_stderr = capture.communicate(timeout=12)
                    except subprocess.TimeoutExpired:
                        self.terminate_child(capture)
                        raise
                    finally:
                        if capture.poll() is not None:
                            with self.children_lock:
                                self.children.discard(capture)
                    result["exit_code"] = capture.returncode
                    if partial.exists() and partial.stat().st_size:
                        content = partial.read_text(encoding="utf-8", errors="replace")
                        if "Call graph:" in content:
                            content = content.replace(str(Path.home()), "~")
                            content = re.sub(r"https?://[^\s\]\)\"<>]+", "[URL]", content)
                            path.write_text(content, encoding="utf-8")
                            result["file"] = "samples/" + filename
                            result["bytes"] = path.stat().st_size
                        else:
                            result["error"] = "sample-returned-no-call-graph"
                    else:
                        result["error"] = "sample-unavailable-permission-or-process-exit"
                    if "error" in result and sample_stderr:
                        self.enqueue(("error", {"at": now(), "operation": "sample",
                                                "message": redact(sample_stderr)[:4000]}))
                    if "error" in result and any(word in (sample_stderr or "").lower() for word in ("permission", "not permitted", "privilege", "root")):
                        result["error"] = "sample-permission-denied"
            except subprocess.TimeoutExpired:
                result["error"] = "sample-timeout"
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
                result["error"] = "sample-command-failed"
            finally:
                try:
                    partial.unlink(missing_ok=True)
                except OSError as error:
                    self.enqueue(("error", {"at": now(), "operation": "remove-partial",
                                            "message": redact(error)[:2000]}))
                result["duration_seconds"] = round(time.monotonic() - began, 3)
                self.sample_results.put_nowait(result)

    def drain_messages(self):
        try:
            result = self.sample_results.get_nowait()
        except queue.Empty:
            pass
        else:
            self.busy = False
            if "file" in result:
                self.samples.append((time.monotonic(), result))
                self.sample_count += 1
                if self.sample_count == 1:
                    print("First native stack saved: " + result["file"], flush=True)
            else:
                identity = result["identity"]
                self.failures[identity] = self.failures.get(identity, 0) + 1
                self.warn(result.get("error", "sample-unavailable"))
            self.record("sample-finished", **result)
        # Do not let a continuous log stream starve the finite-duration/stop checks.
        for _ in range(1000):
            try:
                kind, value = self.messages.get_nowait()
            except queue.Empty:
                break
            if kind == "event":
                self.accept_event(value)
            elif kind == "historical-event":
                self.accept_event(value, historical=True)
            elif kind == "error":
                self.errors.append(value)
            elif kind == "warning":
                self.warn(value)

    def schedule_sample(self):
        if self.busy:
            return
        candidates = [p for p in self.owned.values() if p["kind"] == "webcontent" and self.failures.get(p["identity"], 0) < 2]
        if not candidates:
            return
        proc = min(candidates, key=lambda p: self.last_sample.get(p["identity"], 0))
        tick = time.monotonic()
        if tick - self.last_sample.get(proc["identity"], 0) < self.args.sample_interval:
            return
        self.busy = True
        self.last_sample[proc["identity"]] = tick
        self.jobs.put_nowait(proc)

    def prune(self):
        cutoff = (self.incident_at or time.monotonic()) - self.args.keep_seconds
        # Reserve room for an in-flight sample, metadata and launchd stdout/stderr.
        size = sum(item[1]["bytes"] for item in self.samples)
        reserve = (20 if self.args.launch_mode == "launchd" else 8) * 1024 * 1024
        while self.samples and (self.samples[0][0] < cutoff or size > DISK_LIMIT - reserve):
            _, oldest = self.samples.popleft()
            (self.directory / oldest["file"]).unlink(missing_ok=True)
            size -= oldest["bytes"]
        while self.metrics and (epoch(self.metrics[0]["at"]) or 0) < time.time() - self.args.keep_seconds - self.args.post_seconds:
            self.metrics.popleft()

    def save(self, state="running"):
        write_json(self.directory / "events.json", list(self.events))
        write_json(self.directory / "metrics.json", list(self.metrics))
        write_json(self.directory / "errors.json", list(self.errors))
        write_json(self.directory / "status.json", {
            "schema_version": 1, "state": state, "collector_pid": os.getpid(),
            "run_id": self.run_id, "collector_start_time": self.collector_start_time,
            "launch_mode": self.args.launch_mode,
            "started_at": self.started_at, "updated_at": now(),
            "duration_seconds": self.args.duration, "keep_seconds": self.args.keep_seconds,
            "sample_interval_seconds": self.args.sample_interval,
            "sample_duration_seconds": 1, "sample_interval_milliseconds": 10,
            "sampling_policy": "Serial, oldest sampled WebContent first; actual gaps grow with process count and symbolication time.",
            "disk_limit_bytes": DISK_LIMIT, "reason": self.reason if state in ("finished", "failed") else None,
            "incident": self.incident, "total_samples": self.sample_count,
            "retained_samples": [item[1] for item in self.samples],
            "targets": list(self.identities.values()), "warnings": self.warning_counts,
            "limitations": "Sampling can miss short hangs. Shared WebContent PIDs do not identify a tab or responsible script. Normal exits are recorded, not classified as crashes. RSS is not proof of memory pressure. No automatic upload.",
        })

    def run(self):
        print("Recording directory: " + str(self.directory), flush=True)
        print("Collector PID: " + str(os.getpid()) + "; stops after " + str(self.args.duration) + " seconds.", flush=True)
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, lambda *_: self.stop.set())
        self.record("collector-started")
        self.save()
        try:
            self.start_log_stream()
            self.discover_existing()
            self.worker = threading.Thread(target=self.sample_worker, daemon=True)
            self.worker.start()
            next_metrics = next_save = 0
            while not self.stop.is_set():
                tick = time.monotonic()
                self.drain_messages()
                if (self.discovery_process and self.discovery_process.poll() is None
                        and tick - self.discovery_started >= 30):
                    self.terminate_child(self.discovery_process)
                    self.warn("Initial Safari process discovery timed out")
                if tick - self.started >= self.args.duration:
                    break
                if self.incident_at and tick - self.incident_at >= self.args.post_seconds:
                    self.reason = "unresponsive-incident-captured"
                    break
                if (self.directory / "STOP").exists():
                    self.reason = "stop-file"
                    break
                if tick >= next_metrics:
                    self.update_processes()
                    next_metrics = tick + 1
                self.schedule_sample()
                self.prune()
                if tick >= next_save:
                    self.save()
                    next_save = tick + 5
                self.stop.wait(0.2)
            if self.stop.is_set():
                self.reason = "interrupted"
        except Exception as error:
            self.reason = "collector-error-" + type(error).__name__
            self.report_error("collector", traceback.format_exc())
            print(self.reason, flush=True)
        finally:
            self.stop.set()
            with self.children_lock:
                children = list(self.children)
            for child in children:
                try:
                    self.terminate_child(child)
                except (OSError, subprocess.SubprocessError) as error:
                    self.report_error("child-cleanup", error)
            if self.worker:
                self.worker.join(timeout=10)
            self.drain_messages()
            self.prune()
            self.record("collector-finished", reason=self.reason)
            self.save("failed" if self.reason.startswith("collector-error-") else "finished")
            print("Finished: " + self.reason + "; native samples: " + str(self.sample_count), flush=True)
        return 1 if self.reason.startswith("collector-error-") else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=int, default=600, help="Maximum recording seconds (30-3600)")
    parser.add_argument("--sample-interval", type=float, default=5, help="Minimum seconds between samples of one process (at least 3)")
    parser.add_argument("--keep-seconds", type=int, default=120, help="Rolling native stack window (30-300 seconds)")
    parser.add_argument("--post-seconds", type=int, default=15, help="Record after an unresponsive event (5-60 seconds)")
    parser.add_argument("--output", type=Path, default=Path.home() / "Library/Logs/Bilibili-Clear")
    parser.add_argument("--run-directory", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--launch-mode", choices=("foreground", "launchd"), default="foreground", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This collector requires macOS.")
    if not 30 <= args.duration <= 3600 or not 3 <= args.sample_interval <= 60:
        parser.error("duration must be 30-3600; sample-interval must be 3-60")
    if not 30 <= args.keep_seconds <= 300 or not 5 <= args.post_seconds <= 60:
        parser.error("keep-seconds must be 30-300; post-seconds must be 5-60")
    initialize()
    try:
        # Held for the entire lifetime, shared by foreground and launchd entry points.
        with lock("collector.lock"):
            return Recorder(args).run()
    except BlockingIOError:
        print("Another Safari diagnostics collector already holds the running lock.", file=sys.stderr)
        reason = "another-collector-is-running"
    except Exception as error:
        print(redact(traceback.format_exc()), file=sys.stderr)
        reason = "collector-startup-or-finalize-error-" + type(error).__name__
    if args.run_directory and args.run_directory.is_dir():
        previous = read_json(args.run_directory / "status.json")
        write_json(args.run_directory / "status.json", {**previous, "state": "failed", "reason": reason, "updated_at": now()})
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
