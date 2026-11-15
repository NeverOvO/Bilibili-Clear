"""Private local state shared by the foreground recorder and temporary launchd job."""

from contextlib import contextmanager
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


CONTROL = Path.home() / "Library/Application Support/Bilibili-Clear/SafariDiagnostics"
LOG_ROOT = Path.home() / "Library/Logs/Bilibili-Clear"
LABEL = "com.bilibili-clear.safari-diagnostics"


def timestamp():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)


def initialize():
    os.umask(0o077)
    private_directory(CONTROL)
    private_directory(LOG_ROOT)


def read_json(path):
    try:
        with path.open(encoding="utf-8") as stream:
            value = json.load(stream)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_json(path, value):
    """Replace one private metadata file atomically, so readers never see truncation."""
    descriptor, temporary = tempfile.mkstemp(prefix=".state-", dir=str(path.parent))
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def redact(text):
    text = str(text).replace(str(Path.home()), "~")
    return re.sub(r"https?://[^\s\]\)\"<>]+", "[URL]", text)


@contextmanager
def lock(name, blocking=False):
    descriptor = os.open(str(CONTROL / name), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        yield descriptor
    finally:
        os.close(descriptor)


def collector_locked():
    try:
        with lock("collector.lock"):
            return False
    except BlockingIOError:
        return True


def process_start(pid):
    """Read an exact process identity; a missing or inaccessible process returns None."""
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return None
    try:
        result = subprocess.run(
            ["/bin/ps", "-p", str(pid), "-o", "lstart="],
            capture_output=True, text=True, timeout=3,
            env={**os.environ, "LC_ALL": "C"},
        )
        return result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else None
    except (OSError, subprocess.SubprocessError):
        return None


def current_status():
    """Do not trust a persisted 'running' flag after a crash, kill or host-session exit."""
    latest = read_json(CONTROL / "latest.json")
    directory = Path(latest["directory"]) if latest.get("directory") else None
    status = read_json(directory / "status.json") if directory else {}
    held = collector_locked()
    pid = status.get("collector_pid")
    identity = process_start(pid) if held else None
    matches = bool(identity and identity == status.get("collector_start_time"))
    state = status.get("state", "not-started")
    if held and not matches:
        state = "unknown-active"
    elif held and matches:
        try:
            age = (datetime.now().astimezone() - datetime.fromisoformat(status["updated_at"])).total_seconds()
        except (ValueError, KeyError, TypeError):
            age = float("inf")
        state = "running" if age <= 30 else "unresponsive-recorder"
    elif state in ("running", "starting", "stopping"):
        state = "stale"
    return {**status, "observed_state": state, "lock_held": held,
            "identity_matches": matches, "directory": str(directory) if directory else None}
