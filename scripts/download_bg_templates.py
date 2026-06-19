#!/usr/bin/env python3
"""
Download and trim pre-baked gaming background clips for ClipKings.

Usage:
  python download_bg_templates.py <name> <YouTube-URL>

Valid names:
  subway_surfers        https://www.youtube.com/watch?v=<original>
  subway_surfers_2      https://www.youtube.com/watch?v=Jb-fAwCiSLs
  minecraft_parkour     https://www.youtube.com/watch?v=<original>
  minecraft_parkour_2   https://www.youtube.com/watch?v=nk0Ka2PUpKQ
  gta                   https://www.youtube.com/watch?v=<original>
  gta_2                 https://www.youtube.com/watch?v=weAUrmRLpnk

Each clip is trimmed to 60 seconds and muted, then saved to bg_templates/.
The 60-second clip loops automatically in the generated video.

To download all new variant 2 clips at once:
  python download_bg_templates.py subway_surfers_2   https://www.youtube.com/watch?v=Jb-fAwCiSLs
  python download_bg_templates.py minecraft_parkour_2 https://www.youtube.com/watch?v=nk0Ka2PUpKQ
  python download_bg_templates.py gta_2              https://www.youtube.com/watch?v=weAUrmRLpnk
"""
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

# Resolve yt-dlp relative to the running Python interpreter's bin dir
_BIN = Path(sys.executable).parent
YTDLP  = str(_BIN / "yt-dlp")
FFMPEG = "ffmpeg"


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
