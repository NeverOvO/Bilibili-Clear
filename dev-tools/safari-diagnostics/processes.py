"""Read process identities and reduce Safari logs to bounded, structured events.

No command arguments, webpage content, or raw log messages are returned. A WebKit
process in a snapshot is only a candidate: other applications use WebKit too.
The caller must join Safari's explicit PID references to a current snapshot and
retain both PID and start_time before selecting a process for sampling.
"""

import math
import os
import re
import subprocess
from typing import Any, Dict, Optional


_SAFARI_SUFFIX = "/Safari.app/Contents/MacOS/Safari"
_WEBKIT_BINARIES = {
    "com.apple.WebKit.WebContent": "webcontent",
    "com.apple.WebKit.GPU": "gpu",
}
_PROXY_REFERENCE = re.compile(
    r"^(?:0x[0-9a-fA-F]+\s*-\s*)?"
    r"\[(?P<context>[^\]\r\n]{1,256})\]\s*"
    r"(?P<proxy>WebProcessProxy|WebPageProxy|GPUProcessProxy)::"
    r"(?P<method>[A-Za-z_][A-Za-z0-9_]*)"
)
_CONTEXT_PID = re.compile(r"(?:^|,\s*)PID\s*=\s*([1-9][0-9]*)(?=\s*(?:,|$))")
_UNRESPONSIVE_PAGE = re.compile(
    r"^Page \(pid:\s*([1-9][0-9]*)\) did become unresponsive\s*$"
)
_TERMINATING_PAGE = re.compile(
    r"^Unresponsive page \(pid:\s*([1-9][0-9]*)\) "
    r"is being terminated since it's not visible\s*$"
)
_NAMED_PROCESS = re.compile(r"^(WebContent|GPU|GPUProcess)\[([1-9][0-9]*)\](?:\s|$)")
_REASON = re.compile(r"\breason=([A-Za-z][A-Za-z0-9_]{0,63})(?=$|[\s,;)])")
_UNRESPONSIVE_METHODS = {
    "didBecomeUnresponsive",
    "processDidBecomeUnresponsive",
    "didBecomeUnresponsiveWhileInBackground",
}
_TERMINATION_METHODS = {
    "requestTermination",
    "terminate",
    "processDidTerminateOrFailedToLaunch",
    "processDidTerminate",
    "dispatchProcessDidTerminate",
    "processTerminated",
    "processDidExit",
    "gpuProcessExited",
}


def _is_safari_image(path: Any) -> bool:
    return isinstance(path, str) and path.endswith(_SAFARI_SUFFIX)


def _positive_pid(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 0 < value <= 2147483647 else None
    if isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,9}", value):
        number = int(value)
        return number if number <= 2147483647 else None
    return None


def snapshot_processes() -> Dict[int, Dict[str, Any]]:
    """Return Safari and WebKit WebContent/GPU candidates indexed by PID.

    Each value has pid, ppid, comm, start_time, cpu_percent and rss_kb. comm is
    the executable path, never argv. start_time is ps lstart in the C locale,
    e.g. ``Fri Nov 13 14:56:12 2026``: local time, one-second precision. CPU is
    ps's reported percentage, not a newly calculated interval utilization;
    RSS is resident KiB, not a memory-pressure or memory-leak diagnosis.

    A failed/blocked ps raises RuntimeError instead of pretending all watched
    processes disappeared. Malformed rows are skipped. This function neither
    samples nor signals a process, and makes no ownership inference from PPID.
    """
    environment = os.environ.copy()
    environment["LC_ALL"] = "C"
    try:
        result = subprocess.run(
            ["/bin/ps", "-axo", "pid=,ppid=,pcpu=,rss=,lstart=,comm="],
            capture_output=True,
            text=True,
            errors="replace",
            env=environment,
            timeout=8,
            check=True,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("Could not read the macOS process snapshot") from error

    snapshot = {}
    for line in result.stdout.splitlines():
        # Four numeric fields, five lstart fields, then the entire executable path.
        parts = line.split(None, 9)
        if len(parts) != 10:
            continue
        comm = parts[9].strip()
        webkit = (
            "/WebKit.framework/" in comm
            and os.path.basename(comm) in _WEBKIT_BINARIES
        )
        if not (_is_safari_image(comm) or webkit):
            continue
        try:
            pid = _positive_pid(parts[0])
            ppid = int(parts[1])
            cpu_percent = float(parts[2])
            rss_kb = int(parts[3])
        except ValueError:
            continue
        if (
            pid is None
            or ppid < 0
            or not math.isfinite(cpu_percent)
            or cpu_percent < 0
            or rss_kb < 0
        ):
            continue
        snapshot[pid] = {
            "pid": pid,
            "ppid": ppid,
            "comm": comm,
            "start_time": " ".join(parts[4:9]),
            "cpu_percent": cpu_percent,
            "rss_kb": rss_kb,
        }
    return snapshot


def parse_safari_event(eventdict: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Reduce one log show/stream JSON event, or return None without a typed PID.

    Returns {timestamp, safari_pid, targets: [{pid, kind}], event, reason?}.
    kind is webcontent or gpu; event is unresponsive, termination or
    process-reference. Termination includes explicit termination *requests*;
    it does not claim the process has exited. reason, when present, is only a
    bounded identifier token following reason=, never the full message.

    Only Safari's own processImagePath is accepted. Recognized proxy prefixes
    require an explicit PID= field; pageProxyID, webPageID, hexadecimal object
    addresses and other numbers are never treated as PIDs. Generic auxiliary
    process or ProcessAssertion messages lack a reliable kind and are ignored.
    Historical references are ownership evidence at their event time, not proof
    that a currently running process with the same numeric PID is that process.
    """
    if not isinstance(eventdict, dict) or not _is_safari_image(eventdict.get("processImagePath")):
        return None
    safari_pid = _positive_pid(eventdict.get("processID"))
    message = eventdict.get("eventMessage")
    timestamp = eventdict.get("timestamp")
    if (
        safari_pid is None
        or not isinstance(message, str)
        or not isinstance(timestamp, str)
        or not timestamp
        or len(timestamp) > 64
    ):
        return None

    message = message.strip()
    kind = "webcontent"
    event_type = "process-reference"
    target_pid = None
    proxy = _PROXY_REFERENCE.match(message)
    if proxy:
        pid_match = _CONTEXT_PID.search(proxy.group("context"))
        if pid_match:
            target_pid = _positive_pid(pid_match.group(1))
            if proxy.group("proxy") == "GPUProcessProxy":
                kind = "gpu"
            method = proxy.group("method")
            if method in _UNRESPONSIVE_METHODS:
                event_type = "unresponsive"
            elif method in _TERMINATION_METHODS:
                event_type = "termination"
    else:
        unresponsive = _UNRESPONSIVE_PAGE.match(message)
        terminating = _TERMINATING_PAGE.match(message)
        named = _NAMED_PROCESS.match(message)
        if unresponsive:
            target_pid = _positive_pid(unresponsive.group(1))
            event_type = "unresponsive"
        elif terminating:
            target_pid = _positive_pid(terminating.group(1))
            event_type = "termination"
        elif named:
            target_pid = _positive_pid(named.group(2))
            kind = "webcontent" if named.group(1) == "WebContent" else "gpu"

    if target_pid is None or target_pid == safari_pid:
        return None
    result = {
        "timestamp": timestamp,
        "safari_pid": safari_pid,
        "targets": [{"pid": target_pid, "kind": kind}],
        "event": event_type,
    }
    if event_type == "termination":
        reason = _REASON.search(message)
        if reason:
            result["reason"] = reason.group(1)
    return result
