import subprocess
import tempfile
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shortform_studio.config import EXPORTS_DIR
from shortform_studio.ffmpeg import build_cmd_ranking
from shortform_studio.probe import has_audio as probe_has_audio
from shortform_studio.yt import download_video

from .state import _jobs, find_downloaded

router = APIRouter()


class RankingItem(BaseModel):
    url: str
    start: str = "0:00"
    end: str
    label: str = ""
    color: str = "#FFFFFF"
    fit: str = "crop"
    crop_x: float = 0.5
    crop_y: float = 0.5


class RankingReq(BaseModel):
    title: str = "RANKING"
    title_color: str = "#FFFFFF"
    subtitle: str = ""
    subtitle_color: str = "#FFD700"
    items: list[RankingItem]
    resolution: str = "1080x1920"
    codec: str = "h264"
    crf: int = 23
    mute: bool = False
    font_size: int = 0


@router.post("/api/generate/ranking")
def api_generate_ranking(req: RankingReq):
    if not req.items:
        raise HTTPException(400, detail="At least one item is required")
    if len(req.items) > 20:
        raise HTTPException(400, detail="Maximum 20 items allowed")
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "queued", "logs": [], "output": None, "progress": 0}
    threading.Thread(target=_run_ranking_job, args=(job_id, req), daemon=True).start()
    return {"job_id": job_id}


def _run_ranking_job(job_id: str, req: RankingReq):
    from shortform_studio.timestamps import parse_ts
    job = _jobs[job_id]

    def log(msg: str, level: str = "inf"):
        job["logs"].append({"ts": datetime.now().strftime("%H:%M:%S"), "msg": msg, "level": level})

    job["status"] = "running"
    try:
        try:
            cw, ch = map(int, req.resolution.split("x"))
        except Exception:
            cw, ch = 1080, 1920
        codec = req.codec if req.codec in ("h264", "h265", "vp9") else "h264"
        ext = ".webm" if codec == "vp9" else ".mp4"

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            downloaded: list[Path] = []

            for i, item in enumerate(req.items):
                job["progress"] = 5 + int(50 * i / len(req.items))
                log(f"[INFO] Downloading clip {i+1}/{len(req.items)}…")
                dest = tmp_dir / f"clip_{i:02d}.mp4"
                if not download_video(item.url.strip(), dest):
                    log(f"[ERROR] Download failed for clip {i+1} — check the URL", "err")
                    job["status"] = "failed"
                    return
                actual = find_downloaded(dest)
                if not actual:
                    log(f"[ERROR] Downloaded file not found for clip {i+1}", "err")
                    job["status"] = "failed"
                    return
                downloaded.append(actual)
                log(f"[OK] Clip {i+1} downloaded", "ok")

            items_data: list[dict] = []
            for i, (item, path) in enumerate(zip(req.items, downloaded)):
                try:
                    start_sec = parse_ts(item.start)
                    end_sec = parse_ts(item.end)
                except ValueError as e:
                    log(f"[ERROR] Clip {i+1} bad timestamp: {e}", "err")
                    job["status"] = "failed"
                    return
                if end_sec <= start_sec:
                    end_sec = start_sec + 5.0
                valid_fits = ("crop", "blur", "letterbox")
                items_data.append({
                    "path": str(path),
                    "start_sec": start_sec,
                    "end_sec": end_sec,
                    "label": item.label or f"Item {i+1}",
                    "color": item.color,
                    "fit": item.fit if item.fit in valid_fits else "crop",
                    "crop_x": max(0.0, min(1.0, item.crop_x)),
                    "crop_y": max(0.0, min(1.0, item.crop_y)),
                    "has_audio": probe_has_audio(str(path)),
                })

            ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = EXPORTS_DIR / f"short_ranking_{ts_str}{ext}"
            log(f"[INFO] {len(items_data)} clips · {cw}×{ch} · {codec.upper()}")

            cmd = build_cmd_ranking(
                items=items_data,
                output_path=output_path,
                title=req.title or "RANKING",
                title_color=req.title_color,
                subtitle=req.subtitle,
                subtitle_color=req.subtitle_color,
                canvas_w=cw, canvas_h=ch,
                crf=req.crf, codec=codec, mute=req.mute,
                font_size=req.font_size,
            )

            job["progress"] = 60
            log("[INFO] Starting FFmpeg render…")

            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    log(line, "err" if "error" in line.lower() else "inf")
            proc.wait()

            if proc.returncode != 0:
                log("[ERROR] FFmpeg render failed", "err")
                job["status"] = "failed"
                return
            if not output_path.exists():
                log("[ERROR] Output file not found after render", "err")
                job["status"] = "failed"
                return

            log(f"[OK] Ranking render complete → {output_path.name}", "ok")
            job["status"] = "completed"
            job["output"] = output_path.name
            job["has_audio"] = probe_has_audio(str(output_path))
            job["progress"] = 100

    except Exception as exc:
        job["logs"].append({"ts": datetime.now().strftime("%H:%M:%S"),
                            "msg": f"[ERROR] {exc}", "level": "err"})
        job["status"] = "failed"
