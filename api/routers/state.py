"""Shared in-memory state and helper functions used across all routers."""
import json
from pathlib import Path

from shortform_studio.config import UPLOADS_DIR

_jobs: dict = {}

_UPLOAD_INDEX = UPLOADS_DIR / "index.json"
_ALLOWED_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".ts", ".flv"}
_ALLOWED_AUDIO_EXTS = {".mp3", ".aac", ".wav", ".m4a", ".ogg", ".flac"}
_ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".jfif", ".avif"}
_MAX_UPLOAD_MB = 500

_BG_VALID = {
    "subway_surfers", "subway_surfers_2",
    "minecraft_parkour", "minecraft_parkour_2",
    "gta", "gta_2",
    "satisfying", "satisfying_2",
}


def load_uploads() -> list[dict]:
    if not _UPLOAD_INDEX.exists():
        return []
    try:
        entries = json.loads(_UPLOAD_INDEX.read_text(encoding="utf-8"))
        changed = False
        for e in entries:
            if "name" not in e:
                e["name"] = e.get("original_name") or f"{e['id']}{e.get('ext', '')}"
                changed = True
            if "path" not in e:
                e["path"] = str(UPLOADS_DIR / f"{e['id']}{e.get('ext', '')}")
                changed = True
        if changed:
            _UPLOAD_INDEX.write_text(json.dumps(entries, indent=2), encoding="utf-8")
        return entries
    except Exception:
        return []


def save_uploads(data: list[dict]) -> None:
    _UPLOAD_INDEX.write_text(json.dumps(data, indent=2), encoding="utf-8")


def find_downloaded(expected: Path) -> Path | None:
    """Return the file yt-dlp actually wrote — may differ in extension from expected."""
    if expected.exists():
        return expected
    candidates = sorted(
        expected.parent.glob(expected.stem + ".*"),
        key=lambda p: p.stat().st_size,
        reverse=True,
    )
    return candidates[0] if candidates else None
