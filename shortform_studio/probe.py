"""
Stream probing utilities.

Uses ffprobe when available; falls back to parsing ffmpeg -hide_banner -i stderr,
which works because ffmpeg outputs stream info to stderr even without ffprobe.
"""
import re
import shutil
import subprocess


def _ffprobe() -> str | None:
    return shutil.which("ffprobe")


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found on PATH")
    return exe


def _ffmpeg_stderr(path: str) -> str:
    """Run ffmpeg -i and return stderr (contains all stream/format info)."""
    result = subprocess.run(
        [_ffmpeg(), "-hide_banner", "-i", str(path)],
        capture_output=True, text=True,
    )
    return result.stderr


# ── Public API ────────────────────────────────────────────────────

def video_dimensions(path: str) -> tuple[int, int]:
    """Return (width, height) of first video stream. Defaults to (1080, 1920)."""
    if _ffprobe():
        result = subprocess.run(
            [_ffprobe(), "-v", "quiet", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", str(path)],
            capture_output=True, text=True,
        )
        w, h = 1080, 1920
        for line in result.stdout.splitlines():
            if line.startswith("width="):
                w = int(line.split("=")[1])
            elif line.startswith("height="):
                h = int(line.split("=")[1])
        return w, h

    stderr = _ffmpeg_stderr(path)
    m = re.search(r"Stream[^,]*Video[^,]*, [^,]*, (\d{2,5})x(\d{2,5})", stderr)
    if m:
        return int(m.group(1)), int(m.group(2))
    return 1080, 1920


def has_audio(path: str) -> bool:
    """Return True if the file has at least one audio stream."""
    if _ffprobe():
        result = subprocess.run(
            [_ffprobe(), "-v", "quiet", "-show_streams", "-select_streams", "a",
             "-show_entries", "stream=codec_name", str(path)],
            capture_output=True, text=True,
        )
        return "codec_name" in result.stdout

    return bool(re.search(r"Stream[^:]*: Audio:", _ffmpeg_stderr(path)))


def audio_info(path: str) -> dict | None:
    """Return dict with codec_name, sample_rate, channels, or None if no audio."""
    if _ffprobe():
        result = subprocess.run(
            [_ffprobe(), "-v", "quiet", "-show_streams", "-select_streams", "a",
             "-show_entries", "stream=codec_name,sample_rate,channels", str(path)],
            capture_output=True, text=True,
        )
        if "codec_name" not in result.stdout:
            return None
        info = {}
        for line in result.stdout.splitlines():
            if "=" in line and not line.startswith("["):
                k, v = line.split("=", 1)
                info[k] = v
        return info or None

    stderr = _ffmpeg_stderr(path)
    m = re.search(
        r"Stream[^:]*: Audio:\s+(\w+)[^,]*, (\d+) Hz, (\w+)",
        stderr,
    )
    if not m:
        return None
    channels_str = m.group(3)
    channels = "2" if "stereo" in channels_str else "1"
    return {"codec_name": m.group(1), "sample_rate": m.group(2), "channels": channels}


def file_duration(path: str) -> float | None:
    """Return duration in seconds, or None if it can't be determined."""
    if _ffprobe():
        result = subprocess.run(
            [_ffprobe(), "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True,
        )
        raw = result.stdout.strip()
        try:
            return float(raw)
        except ValueError:
            return None

    stderr = _ffmpeg_stderr(path)
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", stderr)
    if not m:
        return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
