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


def download_video(url: str, out_path: Path) -> bool:
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
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return True
    except Exception as exc:
        log_message(f"[ERROR] Download failed: {exc}", "err")
        return False
