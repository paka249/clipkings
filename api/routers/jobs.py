import subprocess
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shortform_studio.config import BG_TEMPLATES_DIR, EXPORTS_DIR
from shortform_studio.ffmpeg import build_cmd_center_crop, build_cmd_split_screen
from shortform_studio.timestamps import validate_clips
from shortform_studio.yt import download_video

from .state import _BG_VALID, _jobs, find_downloaded, load_uploads

router = APIRouter()


class Clip(BaseModel):
    start: str
    end: str


class GenerateReq(BaseModel):
    primary_url: str = ""
    primary_upload_id: str = ""
    bg_url: str = ""
    bg_upload_id: str = ""
    bg_template: str = ""
    template: str = "center_crop"
    clips: list[Clip]
    resolution: str = "1080x1920"
    codec: str = "h264"
    mute: bool = False
    fit: str = "crop"


@router.post("/api/generate")
def api_generate(req: GenerateReq):
    if not req.primary_url.strip() and not req.primary_upload_id.strip():
        raise HTTPException(400, detail="Provide either primary_url or primary_upload_id")
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "queued", "logs": [], "output": None, "progress": 0}
    threading.Thread(target=_run_job, args=(job_id, req), daemon=True).start()
    return {"job_id": job_id}


@router.get("/api/jobs/{job_id}")
def api_get_job(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(404, detail="Job not found")
    return _jobs[job_id]


def _run_job(job_id: str, req: GenerateReq):
    job = _jobs[job_id]

    def log(msg: str, level: str = "inf"):
        job["logs"].append({"ts": datetime.now().strftime("%H:%M:%S"), "msg": msg, "level": level})

    job["status"] = "running"
    try:
        import tempfile
        raw_clips = [{"start": c.start, "end": c.end} for c in req.clips]
        clips = validate_clips(raw_clips)
        total = sum(c["duration"] for c in clips)
        log(f"[INFO] {len(clips)} clip(s) · total {total:.1f}s")
        job["progress"] = 5

        try:
            cw, ch = map(int, req.resolution.split("x"))
        except Exception:
            cw, ch = 1080, 1920
        crf = 23
        codec = req.codec if req.codec in ("h264", "h265", "vp9") else "h264"
        fit = req.fit if req.fit in ("crop", "blur") else "crop"
        ext = ".webm" if codec == "vp9" else ".mp4"
        log(f"[INFO] Output {cw}×{ch} · {codec.upper()} · CRF {crf} · audio={'off' if req.mute else 'on'} · fit={fit}")

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)

            if req.primary_upload_id.strip():
                uploads = load_uploads()
                match = next((u for u in uploads if u["id"] == req.primary_upload_id.strip()), None)
                if not match:
                    log("[ERROR] Uploaded file not found — it may have been deleted", "err")
                    job["status"] = "failed"
                    return
                primary_path = Path(match["path"])
                if not primary_path.exists():
                    log(f"[ERROR] Upload file missing from disk: {primary_path.name}", "err")
                    job["status"] = "failed"
                    return
                log(f"[OK] Using upload: {primary_path.name} ({match.get('size_mb', '?')} MB)", "ok")
            else:
                log("[INFO] Downloading primary video via yt-dlp…")
                primary_path = tmp_dir / "primary.mp4"
                if not download_video(req.primary_url.strip(), primary_path):
                    log("[ERROR] Primary download failed — check the URL", "err")
                    job["status"] = "failed"
                    return
                primary_path = find_downloaded(primary_path)
                if not primary_path:
                    log("[ERROR] Downloaded primary file not found on disk", "err")
                    job["status"] = "failed"
                    return
                log("[OK] Primary downloaded", "ok")

            probe = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_streams", "-select_streams", "a",
                 "-show_entries", "stream=codec_name,sample_rate,channels", str(primary_path)],
                capture_output=True, text=True,
            )
            if "codec_name" in probe.stdout:
                info = {k: v for line in probe.stdout.splitlines()
                        if "=" in line and not line.startswith("[")
                        for k, v in [line.split("=", 1)]}
                log(f"[OK] Primary audio: {info.get('codec_name','?')} "
                    f"{info.get('sample_rate','?')} Hz {info.get('channels','?')}ch", "ok")
            else:
                log("[WARN] Primary video has NO audio stream — output will be silent regardless of mute setting!", "err")
            job["progress"] = 40

            bg_path = None
            if req.template == "split_screen":
                if req.bg_template:
                    local_bg = BG_TEMPLATES_DIR / f"{req.bg_template}.mp4"
                    if not local_bg.exists():
                        log(f"[ERROR] Gaming template '{req.bg_template}' not on disk — run download_bg_templates.py first", "err")
                        job["status"] = "failed"
                        return
                    bg_path = local_bg
                    log(f"[OK] Using pre-baked background: {local_bg.name}", "ok")
                    job["progress"] = 60
                elif req.bg_upload_id.strip():
                    uploads = load_uploads()
                    bg_match = next((u for u in uploads if u["id"] == req.bg_upload_id.strip()), None)
                    if not bg_match:
                        log("[ERROR] Background upload not found — it may have been deleted", "err")
                        job["status"] = "failed"
                        return
                    bg_path = Path(bg_match["path"])
                    if not bg_path.exists():
                        log(f"[ERROR] Background upload missing from disk: {bg_path.name}", "err")
                        job["status"] = "failed"
                        return
                    log(f"[OK] Using background upload: {bg_path.name}", "ok")
                    job["progress"] = 60
                elif req.bg_url.strip():
                    log("[INFO] Downloading background video…")
                    bg_dl = tmp_dir / "background.mp4"
                    if not download_video(req.bg_url.strip(), bg_dl):
                        log("[ERROR] Background download failed — check the URL", "err")
                        job["status"] = "failed"
                        return
                    bg_path = find_downloaded(bg_dl)
                    if not bg_path:
                        log("[ERROR] Downloaded background file not found on disk", "err")
                        job["status"] = "failed"
                        return
                    log("[OK] Background downloaded", "ok")
                    job["progress"] = 60
                else:
                    log("[ERROR] Split-screen requires a background video, URL, or gaming template", "err")
                    job["status"] = "failed"
                    return

            ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            label = "crop" if req.template == "center_crop" else "split"
            output_path = EXPORTS_DIR / f"short_{label}_{ts_str}{ext}"

            if req.template == "center_crop":
                cmd = build_cmd_center_crop(str(primary_path), clips, output_path,
                                            canvas_w=cw, canvas_h=ch, crf=crf, codec=codec,
                                            mute=req.mute, fit=fit)
            else:
                cmd = build_cmd_split_screen(str(primary_path), str(bg_path), clips, output_path,
                                             canvas_w=cw, canvas_h=ch, crf=crf, codec=codec,
                                             mute=req.mute, fit=fit)

            log("[INFO] Starting FFmpeg render…")
            job["progress"] = 65

            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    log(line, "err" if "error" in line.lower() else "inf")
            proc.wait()

            if proc.returncode != 0:
                log("[ERROR] FFmpeg exited with a non-zero code", "err")
                job["status"] = "failed"
                return
            if not output_path.exists():
                log("[ERROR] Output file missing after render", "err")
                job["status"] = "failed"
                return

            probe_out = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_streams", "-select_streams", "a",
                 "-show_entries", "stream=codec_name", str(output_path)],
                capture_output=True, text=True,
            )
            has_audio = "codec_name" in probe_out.stdout
            log(f"[OK] Render complete → {output_path.name}", "ok")
            if has_audio:
                log("[OK] Output has audio track", "ok")
            else:
                log("[WARN] Output has NO audio track — check primary URL includes sound", "err")
            job["status"] = "completed"
            job["output"] = output_path.name
            job["has_audio"] = has_audio
            job["progress"] = 100

    except Exception as exc:
        job["logs"].append({"ts": datetime.now().strftime("%H:%M:%S"),
                            "msg": f"[ERROR] {exc}", "level": "err"})
        job["status"] = "failed"
