import shutil
import subprocess
import tempfile
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shortform_studio.config import EXPORTS_DIR
from shortform_studio.probe import file_duration, has_audio as probe_has_audio

from .state import _jobs, load_uploads

router = APIRouter()


class EditClip(BaseModel):
    upload_id: str
    start: float = 0.0
    end: float | None = None
    crop_x: float = 0.5
    crop_y: float = 0.5


class AudioClip(BaseModel):
    upload_id: str
    start: float = 0.0
    end: float | None = None


class EditReq(BaseModel):
    sequence: list[EditClip]
    audio_clips: list[AudioClip] = []
    resolution: str = "1080x1920"
    codec: str = "h264"
    fit: str = "crop"


@router.post("/api/edit/render")
def api_edit_render(req: EditReq):
    if not req.sequence:
        raise HTTPException(400, detail="Sequence is empty — add at least one clip")
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "queued", "logs": [], "output": None, "progress": 0}
    threading.Thread(target=_run_edit_job, args=(job_id, req), daemon=True).start()
    return {"job_id": job_id}


def _run_edit_job(job_id: str, req: EditReq):
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
        fit = req.fit if req.fit in ("crop", "pad") else "crop"
        crf = 23
        ext = ".webm" if codec == "vp9" else ".mp4"

        if codec == "h264":
            vcodec = ["-c:v", "libx264", "-preset", "fast", "-crf", str(crf)]
        elif codec == "h265":
            vcodec = ["-c:v", "libx265", "-preset", "fast", "-crf", str(crf)]
        else:
            vcodec = ["-c:v", "libvpx-vp9", "-crf", str(crf), "-b:v", "0"]

        pad_vf = (f"scale={cw}:{ch}:force_original_aspect_ratio=decrease,"
                  f"pad={cw}:{ch}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1")

        uploads = load_uploads()
        uid_map = {u["id"]: u for u in uploads}

        for i, clip in enumerate(req.sequence):
            entry = uid_map.get(clip.upload_id)
            if not entry:
                log(f"[ERROR] Clip {i+1}: upload '{clip.upload_id}' not found", "err")
                job["status"] = "failed"; return
            if not Path(entry["path"]).exists():
                log(f"[ERROR] Clip {i+1}: file missing from disk — {entry['name']}", "err")
                job["status"] = "failed"; return

        n = len(req.sequence)
        log(f"[INFO] {n} clip(s) · {cw}×{ch} {codec.upper()} · fit={fit}")
        job["progress"] = 5

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            processed = []

            for i, clip in enumerate(req.sequence):
                entry = uid_map[clip.upload_id]
                src_path = Path(entry["path"])
                clip_dur = entry.get("duration")

                t_end = clip.end
                if t_end is None and clip_dur:
                    t_end = clip_dur
                duration_sec = (t_end - clip.start) if t_end else None

                log(f"[INFO] Clip {i+1}/{n}: {entry['name']}")

                if fit == "crop":
                    cx = max(0.0, min(1.0, clip.crop_x))
                    cy = max(0.0, min(1.0, clip.crop_y))
                    scale_vf = (
                        f"scale={cw}:{ch}:force_original_aspect_ratio=increase,"
                        f"crop={cw}:{ch}:(iw-{cw})*{cx:.4f}:(ih-{ch})*{cy:.4f},setsar=1"
                    )
                else:
                    scale_vf = pad_vf

                has_audio = probe_has_audio(str(src_path))

                out_clip = tmp_dir / f"clip_{i:04d}.mp4"
                cmd = ["ffmpeg", "-y"]
                if clip.start > 0:
                    cmd += ["-ss", str(clip.start)]
                cmd += ["-i", str(src_path)]
                if not has_audio:
                    cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
                if duration_sec and duration_sec > 0:
                    cmd += ["-t", str(duration_sec)]
                cmd += ["-vf", scale_vf]
                cmd += vcodec
                cmd += ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"]
                if not has_audio:
                    cmd += ["-map", "0:v", "-map", "1:a", "-shortest"]
                cmd.append(str(out_clip))

                r = subprocess.run(cmd, capture_output=True, text=True)
                if r.returncode != 0:
                    log(f"[ERROR] Clip {i+1} failed: {r.stderr[-400:]}", "err")
                    job["status"] = "failed"; return

                processed.append(out_clip)
                job["progress"] = 5 + int((i + 1) / n * 75)
                log(f"[OK] Clip {i+1} processed", "ok")

            concat_file = tmp_dir / "concat.txt"
            concat_file.write_text("\n".join(f"file '{p}'" for p in processed), encoding="utf-8")

            ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = EXPORTS_DIR / f"short_edit_{ts_str}{ext}"
            log("[INFO] Assembling final video…")
            job["progress"] = 82

            combined = tmp_dir / f"combined{ext}"
            r = subprocess.run(
                ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
                 "-i", str(concat_file), "-c", "copy", str(combined)],
                capture_output=True, text=True,
            )
            if r.returncode != 0:
                log(f"[ERROR] Concat failed: {r.stderr[-400:]}", "err")
                job["status"] = "failed"; return

            if req.audio_clips:
                audio_segs = []
                for i, ac in enumerate(req.audio_clips):
                    entry = uid_map.get(ac.upload_id)
                    if not entry:
                        log(f"[WARN] Audio clip {i+1}: upload not found, skipping", "err"); continue
                    src = Path(entry["path"])
                    if not src.exists():
                        log(f"[WARN] Audio clip {i+1}: file missing, skipping", "err"); continue
                    seg = tmp_dir / f"audio_{i:04d}.aac"
                    cmd_trim = ["ffmpeg", "-y"]
                    if ac.start > 0:
                        cmd_trim += ["-ss", str(ac.start)]
                    cmd_trim += ["-i", str(src)]
                    if ac.end is not None and ac.end > ac.start:
                        cmd_trim += ["-t", str(ac.end - ac.start)]
                    cmd_trim += ["-vn", "-c:a", "aac", "-b:a", "128k", str(seg)]
                    r = subprocess.run(cmd_trim, capture_output=True, text=True)
                    if r.returncode != 0:
                        log(f"[WARN] Audio clip {i+1}: trim failed, skipping", "err"); continue
                    audio_segs.append(seg)

                if audio_segs:
                    log(f"[INFO] Applying {len(audio_segs)} audio clip(s) sequentially…")
                    audio_concat_list = tmp_dir / "audio_concat.txt"
                    audio_concat_list.write_text(
                        "\n".join(f"file '{p}'" for p in audio_segs), encoding="utf-8"
                    )
                    audio_combined = tmp_dir / "audio_combined.aac"
                    r = subprocess.run(
                        ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
                         "-i", str(audio_concat_list), "-c", "copy", str(audio_combined)],
                        capture_output=True, text=True,
                    )
                    if r.returncode != 0:
                        log("[WARN] Audio concat failed, keeping clip audio", "err")
                        shutil.copy2(combined, output_path)
                    else:
                        combined_dur = str(file_duration(str(combined)) or 0)
                        r2 = subprocess.run(
                            ["ffmpeg", "-y", "-i", str(combined),
                             "-stream_loop", "-1", "-i", str(audio_combined),
                             "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
                             "-map", "0:v", "-map", "1:a", "-t", combined_dur,
                             str(output_path)],
                            capture_output=True, text=True,
                        )
                        if r2.returncode != 0:
                            log(f"[ERROR] Audio merge failed: {r2.stderr[-400:]}", "err")
                            job["status"] = "failed"; return
                else:
                    log("[WARN] No valid audio clips found, keeping clip audio", "err")
                    shutil.copy2(combined, output_path)
            else:
                shutil.copy2(combined, output_path)

            log(f"[OK] Editor render complete → {output_path.name}", "ok")
            job["status"] = "completed"
            job["output"] = output_path.name
            job["has_audio"] = True
            job["progress"] = 100

    except Exception as exc:
        job["logs"].append({"ts": datetime.now().strftime("%H:%M:%S"),
                            "msg": f"[ERROR] {exc}", "level": "err"})
        job["status"] = "failed"
