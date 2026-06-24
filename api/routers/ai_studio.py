import shutil
import subprocess
import tempfile
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shortform_studio.config import EXPORTS_DIR, UPLOADS_DIR
from shortform_studio.ffmpeg import build_cmd_ai_studio
from shortform_studio.yt import download_video

from .state import _jobs, find_downloaded, load_uploads

router = APIRouter()


class AiStudioReq(BaseModel):
    source_url: str = ""
    upload_id: str = ""
    do_subtitles: bool = False
    sub_model: str = "base"
    sub_font: str = "DejaVu Sans Bold"
    sub_size: int = 48
    sub_color: str = "#FFFFFF"
    sub_style: str = "shadow"
    sub_position: int = 85
    do_voiceover: bool = False
    vo_script: str = ""
    vo_voice: str = "jenny"
    vo_mix: str = "replace"
    codec: str = "h264"
    crf: int = 23


@router.post("/api/generate/ai-studio")
def api_generate_ai_studio(req: AiStudioReq):
    if not req.source_url.strip() and not req.upload_id.strip():
        raise HTTPException(400, detail="Provide a source URL or select an upload")
    if not req.do_subtitles and not req.do_voiceover:
        raise HTTPException(400, detail="Enable at least one of: Subtitles or Voiceover")
    if req.do_voiceover and not req.vo_script.strip():
        raise HTTPException(400, detail="Voiceover script cannot be empty")
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "queued", "logs": [], "output": None, "progress": 0}
    threading.Thread(target=_run_ai_studio_job, args=(job_id, req), daemon=True).start()
    return {"job_id": job_id}


def _run_ai_studio_job(job_id: str, req: AiStudioReq):
    job = _jobs[job_id]

    def log(msg: str, level: str = "inf"):
        job["logs"].append({"ts": datetime.now().strftime("%H:%M:%S"), "msg": msg, "level": level})

    job["status"] = "running"
    try:
        codec = req.codec if req.codec in ("h264", "h265", "vp9") else "h264"
        ext = ".webm" if codec == "vp9" else ".mp4"

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)

            job["progress"] = 5
            if req.upload_id.strip():
                uploads = load_uploads()
                match = next((u for u in uploads if u["id"] == req.upload_id.strip()), None)
                if not match:
                    log("[ERROR] Upload not found — it may have been deleted", "err")
                    job["status"] = "failed"
                    return
                src = UPLOADS_DIR / f"{match['id']}{match['ext']}"
                if not src.exists():
                    log("[ERROR] Upload file missing from disk", "err")
                    job["status"] = "failed"
                    return
                video_path = tmp_dir / f"source{match['ext']}"
                shutil.copy2(src, video_path)
                log(f"[OK] Using upload: {match['name']} ({match['size_mb']} MB)", "ok")
            else:
                log("[INFO] Downloading source video via yt-dlp…")
                dl_dest = tmp_dir / "source.mp4"
                if not download_video(req.source_url.strip(), dl_dest):
                    log("[ERROR] Download failed — check the URL", "err")
                    job["status"] = "failed"
                    return
                found = find_downloaded(dl_dest)
                if not found:
                    log("[ERROR] Downloaded file not found on disk", "err")
                    job["status"] = "failed"
                    return
                video_path = found
                log("[OK] Source video downloaded", "ok")

            job["progress"] = 20

            probe_v = subprocess.run(
                ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", str(video_path)],
                capture_output=True, text=True,
            )
            canvas_w, canvas_h = 1080, 1920
            for line in probe_v.stdout.splitlines():
                if line.startswith("width="):
                    canvas_w = int(line.split("=")[1])
                elif line.startswith("height="):
                    canvas_h = int(line.split("=")[1])

            ass_path: str | None = None
            if req.do_subtitles:
                from shortform_studio.whisper_utils import transcribe
                from shortform_studio.subtitle_utils import segments_to_ass
                segments = transcribe(str(video_path), req.sub_model, log=log)
                job["progress"] = 50
                ass_file = tmp_dir / "subs.ass"
                segments_to_ass(
                    segments, str(ass_file),
                    canvas_w=canvas_w, canvas_h=canvas_h,
                    font=req.sub_font, size=req.sub_size,
                    color_hex=req.sub_color, style=req.sub_style,
                    position=req.sub_position,
                )
                ass_path = str(ass_file)
                log(f"[OK] Subtitles written — {len(segments)} segments", "ok")
            job["progress"] = 55

            vo_path: str | None = None
            if req.do_voiceover:
                from shortform_studio.tts_utils import synthesize
                log(f"[INFO] Synthesizing voiceover with {req.vo_voice.title()} voice…")
                vo_file = tmp_dir / "voiceover.mp3"
                try:
                    synthesize(req.vo_script.strip(), req.vo_voice, str(vo_file))
                    vo_path = str(vo_file)
                    log("[OK] Voiceover generated", "ok")
                except Exception as e:
                    log(f"[ERROR] TTS failed: {e}", "err")
                    log("[ERROR] Make sure edge-tts can reach the internet and retry.", "err")
                    job["status"] = "failed"
                    return
            job["progress"] = 70

            ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = EXPORTS_DIR / f"short_aistudio_{ts_str}{ext}"
            log(f"[INFO] {canvas_w}×{canvas_h} · {codec.upper()} · "
                f"{'subtitles ' if req.do_subtitles else ''}{'voiceover' if req.do_voiceover else ''}")

            cmd = build_cmd_ai_studio(
                video_path=str(video_path),
                ass_path=ass_path,
                vo_path=vo_path,
                output_path=output_path,
                opts={"codec": codec, "crf": req.crf, "vo_mix": req.vo_mix},
            )

            log("[INFO] Starting FFmpeg render…")
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            assert proc.stdout
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
                log("[ERROR] Output file missing after render", "err")
                job["status"] = "failed"
                return

            probe_out = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_streams", "-select_streams", "a",
                 "-show_entries", "stream=codec_name", str(output_path)],
                capture_output=True, text=True,
            )
            log(f"[OK] AI Studio render complete → {output_path.name}", "ok")
            job["status"] = "completed"
            job["output"] = output_path.name
            job["has_audio"] = "codec_name" in probe_out.stdout
            job["progress"] = 100

    except Exception as exc:
        job["logs"].append({"ts": datetime.now().strftime("%H:%M:%S"),
                            "msg": f"[ERROR] {exc}", "level": "err"})
        job["status"] = "failed"
