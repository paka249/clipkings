import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yt_dlp

from .logging_utils import log_message


def _ydl_opts_stream() -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "skip_download": True,
        "noplaylist": True,
    }


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


def _yt_dlp_download(url: str, out_path: Path) -> None:
    # Remove extension from template — yt-dlp appends the correct one after merging.
    # merge_output_format ensures the final file is always mp4.
    stem = str(out_path.with_suffix(""))
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestvideo+bestaudio/best",
        "outtmpl": stem + ".%(ext)s",
        "noplaylist": True,
        "merge_output_format": "mp4",
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])


def _gallery_dl_download(url: str, out_path: Path) -> bool:
    # gallery-dl covers hosts yt-dlp has no extractor for (e.g. Bunkr).
    with tempfile.TemporaryDirectory() as tmp_dir:
        result = subprocess.run(
            [sys.executable, "-m", "gallery_dl", "-D", tmp_dir, "-o", "skip=false", url],
            capture_output=True,
            text=True,
        )
        downloaded = [f for f in Path(tmp_dir).iterdir() if f.is_file()]
        if result.returncode != 0 or not downloaded:
            log_message(
                f"[ERROR] gallery-dl fallback failed: {result.stderr.strip()}", "err"
            )
            return False

        largest = max(downloaded, key=lambda f: f.stat().st_size)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(largest), str(out_path.with_suffix(largest.suffix)))
        return True


def download_video(url: str, out_path: Path) -> bool:
    try:
        _yt_dlp_download(url, out_path)
        return True
    except Exception as exc:
        log_message(f"[ERROR] yt-dlp download failed: {exc}", "err")
        log_message("[INFO] Retrying download via gallery-dl", "info")
        return _gallery_dl_download(url, out_path)
