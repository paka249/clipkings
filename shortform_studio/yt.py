import os
import shutil
from pathlib import Path

import yt_dlp

from .logging_utils import log_message


def _ffmpeg_dir() -> str | None:
    """Return the directory containing ffmpeg, or None if not found."""
    exe = shutil.which("ffmpeg")
    return os.path.dirname(exe) if exe else None


def _ydl_opts_stream() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "skip_download": True,
        "noplaylist": True,
    }
    ffdir = _ffmpeg_dir()
    if ffdir:
        opts["ffmpeg_location"] = ffdir
    return opts


def extract_stream_url(url: str) -> dict | None:
    try:
        with yt_dlp.YoutubeDL(_ydl_opts_stream()) as ydl:
            info = ydl.extract_info(url, download=False)
            direct_url = info.get("url") or info.get("requested_formats", [{}])[0].get("url")
            return {
                "url": direct_url,
                "title": info.get("title", "Unknown"),
                "duration": info.get("duration", 0),
                "thumbnail": info.get("thumbnail", ""),
            }
    except Exception as exc:
        log_message(f"[ERROR] yt-dlp extraction failed: {exc}", "err")
        return None


def download_video(url: str, out_path: Path, log=None) -> bool:
    """Download video to out_path. Pass a log(msg, level) callback to surface errors in job logs."""
    def _log(msg: str, level: str = "inf"):
        log_message(msg, level)
        if log:
            log(msg, level)

    stem = str(out_path.with_suffix(""))
    ffdir = _ffmpeg_dir()

    if ffdir:
        # Request mp4 video + m4a (AAC) audio so both can be stream-copied into
        # mp4 without re-encoding. Falls back to a pre-merged mp4 if unavailable.
        fmt = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        extra = {"merge_output_format": "mp4", "ffmpeg_location": ffdir}
    else:
        fmt = "best[ext=mp4]/best"
        extra = {}
        _log("[WARN] ffmpeg not found — downloading pre-merged stream (max 720p)", "err")

    ydl_opts = {
        "quiet": False,
        "no_warnings": False,
        "no_color": True,
        "format": fmt,
        "outtmpl": stem + ".%(ext)s",
        "noplaylist": True,
        "logger": _YdlLogger(_log),
        **extra,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return True
    except Exception as exc:
        _log(f"[ERROR] yt-dlp: {exc}", "err")
        return False


class _YdlLogger:
    """Routes yt-dlp log output to a job log callback."""
    def __init__(self, log_fn):
        self._log = log_fn

    def debug(self, msg):
        if msg.startswith("[download]") or msg.startswith("[info]") or "[ffmpeg]" in msg:
            self._log(msg, "inf")

    def info(self, msg):
        self._log(msg, "inf")

    def warning(self, msg):
        self._log(f"[WARN] {msg}", "err")

    def error(self, msg):
        self._log(f"[ERROR] {msg}", "err")
