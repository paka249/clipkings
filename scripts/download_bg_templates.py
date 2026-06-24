#!/usr/bin/env python3
"""
Download and trim pre-baked gaming background clips for ClipKings.

Usage:
  python scripts/download_bg_templates.py <name> <YouTube-URL>

  Pass any YouTube URL that has the gameplay you want for that slot.

Valid slot names (any YouTube URL works):
  subway_surfers
  subway_surfers_2
  minecraft_parkour
  minecraft_parkour_2
  gta
  gta_2
  satisfying
  satisfying_2

Each clip is trimmed to 60 seconds, muted, then saved to bg_templates/.
The 60-second clip loops automatically in the generated video.

--- Running inside Docker (recommended — no local yt-dlp needed) ---
  docker compose exec app python scripts/download_bg_templates.py subway_surfers   <URL>
  docker compose exec app python scripts/download_bg_templates.py subway_surfers_2 <URL>
  docker compose exec app python scripts/download_bg_templates.py minecraft_parkour   <URL>
  docker compose exec app python scripts/download_bg_templates.py minecraft_parkour_2 <URL>
  docker compose exec app python scripts/download_bg_templates.py gta               <URL>
  docker compose exec app python scripts/download_bg_templates.py gta_2             <URL>
  docker compose exec app python scripts/download_bg_templates.py satisfying         <URL>
  docker compose exec app python scripts/download_bg_templates.py satisfying_2       <URL>

Files land in bg_templates/ on your host (mounted volume) — restart not required.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

VALID = {
    "subway_surfers",
    "subway_surfers_2",
    "minecraft_parkour",
    "minecraft_parkour_2",
    "gta",
    "gta_2",
    "satisfying",
    "satisfying_2",
}

BG_DIR = Path(__file__).resolve().parent.parent / "bg_templates"
BG_DIR.mkdir(exist_ok=True)

# Find yt-dlp: prefer venv alongside this repo, then PATH
_REPO = Path(__file__).resolve().parent.parent
_YTDLP_VENV = _REPO / "venv" / "bin" / "yt-dlp"
if _YTDLP_VENV.exists():
    YTDLP = str(_YTDLP_VENV)
elif shutil.which("yt-dlp"):
    YTDLP = "yt-dlp"
else:
    print("[ERROR] yt-dlp not found. Install it with:  pip install yt-dlp")
    sys.exit(1)

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"


def download_and_trim(name: str, url: str):
    out_path = BG_DIR / f"{name}.mp4"
    print(f"[1/2] Downloading '{name}' from {url} …")

    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.%(ext)s"
        subprocess.run([
            YTDLP,
            "--quiet",
            "--no-warnings",
            "--format", "bestvideo[height<=1080]+bestaudio/best",
            "--merge-output-format", "mp4",
            "--no-playlist",
            "-o", str(raw),
            url,
        ], check=True)

        candidates = list(Path(tmp).glob("raw.*"))
        if not candidates:
            print("[ERROR] yt-dlp did not produce a file.")
            sys.exit(1)
        src = max(candidates, key=lambda p: p.stat().st_size)

        print(f"[2/2] Trimming to 60 s and muting → {out_path.name} …")
        subprocess.run([
            FFMPEG, "-y",
            "-i", str(src),
            "-t", "60",
            "-an",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-movflags", "+faststart",
            str(out_path),
        ], check=True)

    print(f"[OK] Saved: {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    name_arg = sys.argv[1].lower().replace("-", "_")
    url_arg  = sys.argv[2]

    if name_arg not in VALID:
        print(f"[ERROR] Name must be one of:\n  " + "\n  ".join(sorted(VALID)))
        sys.exit(1)

    download_and_trim(name_arg, url_arg)
