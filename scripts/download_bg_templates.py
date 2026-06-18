#!/usr/bin/env python3
"""
Download and trim pre-baked gaming background clips for Short-Form Studio.

Usage:
  python download_bg_templates.py subway_surfers  <YouTube-URL>
  python download_bg_templates.py minecraft_parkour <YouTube-URL>
  python download_bg_templates.py gta              <YouTube-URL>

Each clip is trimmed to 60 seconds and muted, then saved to bg_templates/.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

VALID = {"subway_surfers", "minecraft_parkour", "gta"}
BG_DIR = Path(__file__).resolve().parent / "bg_templates"
BG_DIR.mkdir(exist_ok=True)

# Resolve yt-dlp and ffmpeg relative to the running Python interpreter's bin dir
_BIN = Path(sys.executable).parent
YTDLP  = str(_BIN / "yt-dlp")
FFMPEG = "ffmpeg"  # assume system ffmpeg; adjust if needed


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

        # Find the downloaded file
        candidates = list(Path(tmp).glob("raw.*"))
        if not candidates:
            print("[ERROR] yt-dlp did not produce a file.")
            sys.exit(1)
        src = max(candidates, key=lambda p: p.stat().st_size)

        print(f"[2/2] Trimming to 60 s and muting → {out_path.name} …")
        subprocess.run([
            "ffmpeg", "-y",
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
        print(f"[ERROR] Name must be one of: {', '.join(VALID)}")
        sys.exit(1)

    download_and_trim(name_arg, url_arg)
