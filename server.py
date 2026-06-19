"""
ClipKings — FastAPI backend.
Run:  venv/bin/python server.py
Open: http://localhost:8080
"""
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from api.database import Base, engine
from api.dependencies import get_current_user
from api.models import User

from shortform_studio.auth import authenticate_user, create_user, get_user
from shortform_studio.config import BG_TEMPLATES_DIR, EXPORTS_DIR, UPLOADS_DIR
from shortform_studio.db import db_session, execute as db_execute, fetch_one, init_db, utc_now
from shortform_studio.ffmpeg import build_cmd_ai_studio, build_cmd_center_crop, build_cmd_ranking, build_cmd_split_screen
from shortform_studio.timestamps import validate_clips
from shortform_studio.yt import download_video, extract_stream_url

app = FastAPI(title="ClipKings")

Path(__file__).parent.joinpath("data").mkdir(exist_ok=True)
Base.metadata.create_all(bind=engine)

# In-memory job store  {job_id: {status, logs, output, progress}}
_jobs: dict = {}


# ── Pydantic models ──────────────────────────────────────────

class PreviewReq(BaseModel):
    url: str

class Clip(BaseModel):
    start: str
    end: str

class RankingItem(BaseModel):
    url: str
    start: str = "0:00"
    end: str
    label: str = ""
    color: str = "#FFFFFF"
    fit: str = "crop"      # "crop" | "blur" | "letterbox"
    crop_x: float = 0.5   # horizontal crop center 0=left 1=right
    crop_y: float = 0.5   # vertical crop center 0=top 1=bottom

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


class RegisterReq(BaseModel):
    email: str
    password: str
    username: str | None = None

class LoginReq(BaseModel):
    identifier: str
    password: str

class GenerateReq(BaseModel):
    primary_url: str = ""
    primary_upload_id: str = ""     # uid from /api/upload — used instead of primary_url
    bg_url: str = ""
    bg_upload_id: str = ""          # uid from /api/upload — used as background instead of bg_url
    bg_template: str = ""           # name of pre-baked bg clip, e.g. "subway_surfers"
    template: str = "center_crop"   # "center_crop" | "split_screen"
    clips: list[Clip]
    resolution: str = "1080x1920"   # "1080x1920" | "720x1280" | "540x960"
    codec: str = "h264"             # "h264" | "h265" | "vp9"
    mute: bool = False
    fit: str = "crop"               # "crop" | "blur"


# ── Auth helpers ─────────────────────────────────────────────

def _create_session(user_id: str) -> str:
    from datetime import timezone, timedelta
    token = str(uuid.uuid4())
    now = utc_now()
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(timespec="seconds")
    with db_session() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now, expires),
        )
    return token


def _token_from_request(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    return auth.removeprefix("Bearer ").strip() or None


def _get_user_from_token(token: str | None):
    if not token:
        return None
    now = datetime.utcnow().isoformat(timespec="seconds")
    row = fetch_one(
        "SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?",
        (token, now),
    )
    return get_user(row["user_id"]) if row else None


# ── Auth routes ───────────────────────────────────────────────

@app.post("/api/auth/register")
def api_register(req: RegisterReq):
    if not req.email or not req.password:
        raise HTTPException(400, detail="Email and password are required")
    if len(req.password) < 8:
        raise HTTPException(400, detail="Password must be at least 8 characters")
    try:
        user = create_user(req.email.strip(), req.password, req.username)
    except Exception as exc:
        msg = str(exc)
        if "UNIQUE" in msg:
            detail = "An account with that email or username already exists"
        else:
            detail = "Registration failed — check your details and try again"
        raise HTTPException(400, detail=detail)
    token = _create_session(user.id)
    return {"token": token, "user": {"id": user.id, "email": user.email, "username": user.username}}


@app.post("/api/auth/login")
def api_login(req: LoginReq):
    user = authenticate_user(req.identifier.strip(), req.password)
    if not user:
        raise HTTPException(401, detail="Incorrect email/username or password")
    token = _create_session(user.id)
    return {"token": token, "user": {"id": user.id, "email": user.email, "username": user.username}}


@app.post("/api/auth/logout")
def api_logout(request: Request):
    token = _token_from_request(request)
    if token:
        db_execute("DELETE FROM sessions WHERE token = ?", (token,))
    return {"ok": True}


@app.get("/api/auth/me")
def api_me(request: Request):
    token = _token_from_request(request)
    user = _get_user_from_token(token)
    if not user:
        raise HTTPException(401, detail="Not authenticated")
    return {"id": user.id, "email": user.email, "username": user.username}


# ── API routes ───────────────────────────────────────────────

@app.post("/api/preview")
def api_preview(req: PreviewReq):
    info = extract_stream_url(req.url.strip())
    if not info:
        raise HTTPException(400, detail="Could not extract stream info. Check the URL.")
    return {
        "title": info["title"],
        "duration": info["duration"],
        "thumbnail": info.get("thumbnail", ""),
        "width": info.get("width") or 0,
        "height": info.get("height") or 0,
    }


@app.post("/api/generate")
def api_generate(req: GenerateReq):
    if not req.primary_url.strip() and not req.primary_upload_id.strip():
        raise HTTPException(400, detail="Provide either primary_url or primary_upload_id")
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "queued", "logs": [], "output": None, "progress": 0}
    threading.Thread(target=_run_job, args=(job_id, req), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def api_get_job(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(404, detail="Job not found")
    return _jobs[job_id]


@app.get("/api/exports")
def api_exports():
    all_files = [*EXPORTS_DIR.glob("*.mp4"), *EXPORTS_DIR.glob("*.webm")]
    files = []
    for f in sorted(all_files, key=lambda x: x.stat().st_mtime, reverse=True):
        files.append({"name": f.name, "size_mb": round(f.stat().st_size / 1_000_000, 1)})
    return files


@app.delete("/api/exports/{filename:path}")
def api_delete_export(filename: str):
    path = (EXPORTS_DIR / filename).resolve()
    if not str(path).startswith(str(EXPORTS_DIR.resolve())):
        raise HTTPException(400, detail="Invalid path")
    if not path.exists():
        raise HTTPException(404, detail="File not found")
    path.unlink()
    return {"deleted": filename}


_BG_VALID = {
    "subway_surfers", "subway_surfers_2",
    "minecraft_parkour", "minecraft_parkour_2",
    "gta", "gta_2",
    "satisfying", "satisfying_2",
}

@app.get("/api/bg-templates")
def api_bg_templates():
    templates = []
    for name in sorted(_BG_VALID):
        path = BG_TEMPLATES_DIR / f"{name}.mp4"
        templates.append({"name": name, "ready": path.exists()})
    return templates


@app.get("/api/bg-video/{name}")
def api_bg_video(name: str):
    if name not in _BG_VALID:
        raise HTTPException(404)
    path = BG_TEMPLATES_DIR / f"{name}.mp4"
    if not path.exists():
        raise HTTPException(404, detail="Gaming template video not downloaded yet — run download_bg_templates.py")
    return FileResponse(str(path), media_type="video/mp4")


@app.get("/api/bg-thumb/{slug}")
def api_bg_thumb(slug: str):
    if slug not in _BG_VALID:
        raise HTTPException(404)
    video_path = BG_TEMPLATES_DIR / f"{slug}.mp4"
    if not video_path.exists():
        raise HTTPException(404, detail="Video not downloaded yet")
    thumb_path = BG_TEMPLATES_DIR / f"{slug}_thumb.jpg"
    if not thumb_path.exists():
        subprocess.run([
            "ffmpeg", "-y", "-ss", "3", "-i", str(video_path),
            "-vframes", "1", "-q:v", "2", str(thumb_path),
        ], check=True, capture_output=True)
    return FileResponse(str(thumb_path), media_type="image/jpeg")


@app.get("/api/download/{filename}")
def api_download(filename: str):
    path = EXPORTS_DIR / filename
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(str(path), media_type="video/mp4", filename=filename,
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/video/{filename}")
def api_video(filename: str):
    path = EXPORTS_DIR / filename
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(str(path), media_type="video/mp4")


@app.post("/api/generate/ranking")
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
                actual = _find_downloaded(dest)
                if not actual:
                    log(f"[ERROR] Downloaded file not found for clip {i+1}", "err")
                    job["status"] = "failed"
                    return
                downloaded.append(actual)
                log(f"[OK] Clip {i+1} downloaded", "ok")

            # Build items data with parsed times + audio probe
            items_data: list[dict] = []
            for i, (item, path) in enumerate(zip(req.items, downloaded)):
                try:
                    start_sec = parse_ts(item.start)
                    end_sec   = parse_ts(item.end)
                except ValueError as e:
                    log(f"[ERROR] Clip {i+1} bad timestamp: {e}", "err")
                    job["status"] = "failed"
                    return
                if end_sec <= start_sec:
                    end_sec = start_sec + 5.0
                probe = subprocess.run(
                    ["ffprobe", "-v", "quiet", "-show_streams", "-select_streams", "a",
                     "-show_entries", "stream=codec_name", str(path)],
                    capture_output=True, text=True,
                )
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
                    "has_audio": "codec_name" in probe.stdout,
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

            probe_out = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_streams", "-select_streams", "a",
                 "-show_entries", "stream=codec_name", str(output_path)],
                capture_output=True, text=True,
            )
            has_audio = "codec_name" in probe_out.stdout
            log(f"[OK] Ranking render complete → {output_path.name}", "ok")
            job["status"] = "completed"
            job["output"]    = output_path.name
            job["has_audio"] = has_audio
            job["progress"]  = 100

    except Exception as exc:
        job["logs"].append({"ts": datetime.now().strftime("%H:%M:%S"), "msg": f"[ERROR] {exc}", "level": "err"})
        job["status"] = "failed"


# ── Uploads ──────────────────────────────────────────────────

_UPLOAD_INDEX = UPLOADS_DIR / "index.json"
_ALLOWED_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".ts", ".flv"}
_ALLOWED_AUDIO_EXTS = {".mp3", ".aac", ".wav", ".m4a", ".ogg", ".flac"}
_MAX_UPLOAD_MB = 500


def _load_uploads() -> list[dict]:
    if not _UPLOAD_INDEX.exists():
        return []
    try:
        entries = json.loads(_UPLOAD_INDEX.read_text(encoding="utf-8"))
        changed = False
        for e in entries:
            if "name" not in e:
                e["name"] = e.get("original_name") or f"{e['id']}{e.get('ext','')}"
                changed = True
            if "path" not in e:
                e["path"] = str(UPLOADS_DIR / f"{e['id']}{e.get('ext','')}")
                changed = True
        if changed:
            _UPLOAD_INDEX.write_text(json.dumps(entries, indent=2), encoding="utf-8")
        return entries
    except Exception:
        return []


def _save_uploads(data: list[dict]) -> None:
    _UPLOAD_INDEX.write_text(json.dumps(data, indent=2), encoding="utf-8")


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if not ext:
        ct = (file.content_type or "").split(";")[0].strip()
        ct_map = {
            "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
            "video/x-matroska": ".mkv", "video/x-msvideo": ".avi",
            "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/wav": ".wav",
            "audio/ogg": ".ogg", "audio/aac": ".aac",
        }
        ext = ct_map.get(ct, "")
    all_allowed = _ALLOWED_EXTS | _ALLOWED_AUDIO_EXTS
    if ext not in all_allowed:
        raise HTTPException(
            400,
            detail=f"Unsupported file type '{ext or 'unknown'}'. "
                   f"Allowed: {', '.join(sorted(all_allowed))}",
        )

    contents = await file.read()
    max_bytes = _MAX_UPLOAD_MB * 1_000_000
    if len(contents) > max_bytes:
        raise HTTPException(413, detail=f"File exceeds {_MAX_UPLOAD_MB} MB limit")

    uid = str(uuid.uuid4())[:8]
    orig_name = file.filename or f"{uid}{ext}"
    dest = UPLOADS_DIR / f"{uid}{ext}"
    dest.write_bytes(contents)

    # Probe duration
    duration = None
    try:
        pr = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(dest)],
            capture_output=True, text=True, timeout=15,
        )
        duration = round(float(pr.stdout.strip()), 2)
    except Exception:
        pass

    size_mb = round(len(contents) / 1_000_000, 2)
    is_audio = ext in _ALLOWED_AUDIO_EXTS
    entry = {
        "id": uid,
        "name": orig_name,
        "ext": ext,
        "size_mb": size_mb,
        "duration": duration,
        "is_audio": is_audio,
        "path": str(dest),
        "uploaded_at": datetime.now().isoformat(timespec="seconds"),
    }
    uploads = _load_uploads()
    uploads.append(entry)
    _save_uploads(uploads)
    return entry


@app.get("/api/uploads")
def api_uploads():
    return _load_uploads()


@app.get("/api/uploads/stream/{uid}")
def api_stream_upload(uid: str):
    uploads = _load_uploads()
    entry   = next((u for u in uploads if u["id"] == uid), None)
    if not entry:
        raise HTTPException(404)
    path = Path(entry["path"])
    if not path.exists():
        raise HTTPException(404)
    media_type = "video/mp4" if entry.get("ext") in (".mp4", ".mov", ".m4v") else "video/webm"
    return FileResponse(str(path), media_type=media_type)


@app.delete("/api/uploads/{uid}")
def api_delete_upload(uid: str):
    uploads = _load_uploads()
    match = next((u for u in uploads if u["id"] == uid), None)
    if not match:
        raise HTTPException(404, detail="Upload not found")
    path = UPLOADS_DIR / f"{uid}{match['ext']}"
    path.unlink(missing_ok=True)
    _save_uploads([u for u in uploads if u["id"] != uid])
    return {"deleted": uid}


# ── Video Editor ─────────────────────────────────────────────

class EditClip(BaseModel):
    upload_id: str
    start: float = 0.0
    end: float | None = None   # None = use full clip duration
    crop_x: float = 0.5       # horizontal crop position: 0=left, 1=right
    crop_y: float = 0.5       # vertical crop position:   0=top,  1=bottom


class AudioClip(BaseModel):
    upload_id: str
    start: float = 0.0
    end: float | None = None


class EditReq(BaseModel):
    sequence: list[EditClip]
    audio_clips: list[AudioClip] = []
    resolution: str = "1080x1920"
    codec: str = "h264"
    fit: str = "crop"          # "crop" | "pad"


@app.post("/api/edit/render")
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
        fit   = req.fit   if req.fit   in ("crop", "pad")         else "crop"
        crf   = 23
        ext   = ".webm" if codec == "vp9" else ".mp4"

        if codec == "h264":
            vcodec = ["-c:v", "libx264", "-preset", "fast", "-crf", str(crf)]
        elif codec == "h265":
            vcodec = ["-c:v", "libx265", "-preset", "fast", "-crf", str(crf)]
        else:
            vcodec = ["-c:v", "libvpx-vp9", "-crf", str(crf), "-b:v", "0"]

        pad_vf = (f"scale={cw}:{ch}:force_original_aspect_ratio=decrease,"
                  f"pad={cw}:{ch}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1")

        uploads  = _load_uploads()
        uid_map  = {u["id"]: u for u in uploads}

        # Validate all clips exist
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
                entry    = uid_map[clip.upload_id]
                src_path = Path(entry["path"])
                clip_dur = entry.get("duration")

                # Determine effective end
                t_end = clip.end
                if t_end is None and clip_dur:
                    t_end = clip_dur
                duration_sec = (t_end - clip.start) if t_end else None

                log(f"[INFO] Clip {i+1}/{n}: {entry['name']}")

                # Per-clip scale filter with crop position
                if fit == "crop":
                    cx = max(0.0, min(1.0, clip.crop_x))
                    cy = max(0.0, min(1.0, clip.crop_y))
                    scale_vf = (
                        f"scale={cw}:{ch}:force_original_aspect_ratio=increase,"
                        f"crop={cw}:{ch}:(iw-{cw})*{cx:.4f}:(ih-{ch})*{cy:.4f},setsar=1"
                    )
                else:
                    scale_vf = pad_vf

                # Probe for audio stream
                probe = subprocess.run(
                    ["ffprobe", "-v", "quiet", "-show_streams", "-select_streams", "a",
                     "-show_entries", "stream=codec_name", str(src_path)],
                    capture_output=True, text=True
                )
                has_audio = "codec_name" in probe.stdout

                out_clip = tmp_dir / f"clip_{i:04d}.mp4"
                cmd = ["ffmpeg", "-y"]

                # Fast input seek
                if clip.start > 0:
                    cmd += ["-ss", str(clip.start)]
                cmd += ["-i", str(src_path)]
                # Add silent audio if clip has none
                if not has_audio:
                    cmd += ["-f", "lavfi", "-i",
                            "anullsrc=channel_layout=stereo:sample_rate=44100"]
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

            # Write concat list
            concat_file = tmp_dir / "concat.txt"
            concat_file.write_text(
                "\n".join(f"file '{p}'" for p in processed), encoding="utf-8"
            )

            ts_str      = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = EXPORTS_DIR / f"short_edit_{ts_str}{ext}"

            log("[INFO] Assembling final video…")
            job["progress"] = 82

            # Stage 2: concat
            combined = tmp_dir / f"combined{ext}"
            r = subprocess.run(
                ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
                 "-i", str(concat_file), "-c", "copy", str(combined)],
                capture_output=True, text=True,
            )
            if r.returncode != 0:
                log(f"[ERROR] Concat failed: {r.stderr[-400:]}", "err")
                job["status"] = "failed"; return

            # Stage 3: optional audio replacement
            if req.audio_clips:
                # Trim each audio clip and collect the valid segments
                audio_segs = []
                for i, ac in enumerate(req.audio_clips):
                    entry = uid_map.get(ac.upload_id)
                    if not entry:
                        log(f"[WARN] Audio clip {i+1}: upload not found, skipping", "err")
                        continue
                    src = Path(entry["path"])
                    if not src.exists():
                        log(f"[WARN] Audio clip {i+1}: file missing, skipping", "err")
                        continue
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
                        log(f"[WARN] Audio clip {i+1}: trim failed, skipping", "err")
                        continue
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
                        dur_probe = subprocess.run(
                            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                             "-of", "csv=p=0", str(combined)],
                            capture_output=True, text=True,
                        )
                        combined_dur = dur_probe.stdout.strip()
                        r2 = subprocess.run(
                            ["ffmpeg", "-y", "-i", str(combined),
                             "-stream_loop", "-1", "-i", str(audio_combined),
                             "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
                             "-map", "0:v", "-map", "1:a",
                             "-t", combined_dur,
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
            job["status"]    = "completed"
            job["output"]    = output_path.name
            job["has_audio"] = True
            job["progress"]  = 100

    except Exception as exc:
        job["logs"].append({"ts": datetime.now().strftime("%H:%M:%S"),
                            "msg": f"[ERROR] {exc}", "level": "err"})
        job["status"] = "failed"


@app.post("/api/generate/ai-studio")
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
        ext   = ".webm" if codec == "vp9" else ".mp4"

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)

            # ── Step 1: Acquire source video ──────────────────────
            job["progress"] = 5
            video_path: Path

            if req.upload_id.strip():
                uploads = _load_uploads()
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
                found = _find_downloaded(dl_dest)
                if not found:
                    log("[ERROR] Downloaded file not found on disk", "err")
                    job["status"] = "failed"
                    return
                video_path = found
                log("[OK] Source video downloaded", "ok")

            job["progress"] = 20

            # Probe video dimensions
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

            # ── Step 2: Whisper transcription ─────────────────────
            ass_path: str | None = None
            if req.do_subtitles:
                from shortform_studio.whisper_utils import transcribe
                from shortform_studio.subtitle_utils import segments_to_ass
                segments = transcribe(str(video_path), req.sub_model, log=log)
                job["progress"] = 50
                ass_file = tmp_dir / "subs.ass"
                segments_to_ass(
                    segments,
                    str(ass_file),
                    canvas_w=canvas_w,
                    canvas_h=canvas_h,
                    font=req.sub_font,
                    size=req.sub_size,
                    color_hex=req.sub_color,
                    style=req.sub_style,
                    position=req.sub_position,
                )
                ass_path = str(ass_file)
                log(f"[OK] Subtitles written — {len(segments)} segments", "ok")
                job["progress"] = 55
            else:
                job["progress"] = 55

            # ── Step 3: TTS synthesis ─────────────────────────────
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
            else:
                job["progress"] = 70

            # ── Step 4: FFmpeg render ─────────────────────────────
            ts_str      = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = EXPORTS_DIR / f"short_aistudio_{ts_str}{ext}"
            log(f"[INFO] {canvas_w}×{canvas_h} · {codec.upper()} · "
                f"{'subtitles ' if req.do_subtitles else ''}"
                f"{'voiceover' if req.do_voiceover else ''}")

            cmd = build_cmd_ai_studio(
                video_path=str(video_path),
                ass_path=ass_path,
                vo_path=vo_path,
                output_path=output_path,
                opts={"codec": codec, "crf": req.crf, "vo_mix": req.vo_mix},
            )

            log("[INFO] Starting FFmpeg render…")
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
            )
            assert proc.stdout
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    log(line, "err" if "error" in line.lower() else "inf")
                # Advance progress slowly during render (70 → 95)
            proc.wait()

            if proc.returncode != 0:
                log("[ERROR] FFmpeg render failed", "err")
                job["status"] = "failed"
                return
            if not output_path.exists():
                log("[ERROR] Output file missing after render", "err")
                job["status"] = "failed"
                return

            # ── Step 5: Probe output ──────────────────────────────
            probe_out = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_streams", "-select_streams", "a",
                 "-show_entries", "stream=codec_name", str(output_path)],
                capture_output=True, text=True,
            )
            has_audio = "codec_name" in probe_out.stdout
            log(f"[OK] AI Studio render complete → {output_path.name}", "ok")
            job["status"]    = "completed"
            job["output"]    = output_path.name
            job["has_audio"] = has_audio
            job["progress"]  = 100

    except Exception as exc:
        job["logs"].append({
            "ts": datetime.now().strftime("%H:%M:%S"),
            "msg": f"[ERROR] {exc}",
            "level": "err",
        })
        job["status"] = "failed"


def _find_downloaded(expected: Path) -> Path | None:
    """Return the file yt-dlp actually wrote — usually matches expected, but may differ in extension."""
    if expected.exists():
        return expected
    candidates = sorted(expected.parent.glob(expected.stem + ".*"),
                        key=lambda p: p.stat().st_size, reverse=True)
    return candidates[0] if candidates else None


# ── Job runner (background thread) ──────────────────────────

def _run_job(job_id: str, req: GenerateReq):
    job = _jobs[job_id]

    def log(msg: str, level: str = "inf"):
        job["logs"].append({"ts": datetime.now().strftime("%H:%M:%S"), "msg": msg, "level": level})

    job["status"] = "running"
    try:
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
        fit   = req.fit   if req.fit   in ("crop", "blur")         else "crop"
        ext = ".webm" if codec == "vp9" else ".mp4"
        log(f"[INFO] Output {cw}×{ch} · {codec.upper()} · CRF {crf} · audio={'off' if req.mute else 'on'} · fit={fit}")

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)

            # Resolve primary source — upload takes precedence over URL
            if req.primary_upload_id.strip():
                uploads = _load_uploads()
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
                primary_path = _find_downloaded(primary_path)
                if not primary_path:
                    log("[ERROR] Downloaded primary file not found on disk", "err")
                    job["status"] = "failed"
                    return
                log("[OK] Primary downloaded", "ok")
            # Probe primary for audio stream
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_streams", "-select_streams", "a",
                 "-show_entries", "stream=codec_name,sample_rate,channels",
                 str(primary_path)],
                capture_output=True, text=True
            )
            if "codec_name" in probe.stdout:
                info = {k: v for line in probe.stdout.splitlines()
                        if "=" in line and not line.startswith("[")
                        for k, v in [line.split("=", 1)]}
                log(f"[OK] Primary audio: {info.get('codec_name','?')} "
                    f"{info.get('sample_rate','?')} Hz "
                    f"{info.get('channels','?')}ch", "ok")
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
                    uploads = _load_uploads()
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
                    bg_path = _find_downloaded(bg_dl)
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

            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
            )
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    lvl = "err" if "error" in line.lower() else "inf"
                    log(line, lvl)
            proc.wait()

            if proc.returncode != 0:
                log("[ERROR] FFmpeg exited with a non-zero code", "err")
                job["status"] = "failed"
                return

            if not output_path.exists():
                log("[ERROR] Output file missing after render", "err")
                job["status"] = "failed"
                return

            # Probe output for audio
            probe_out = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_streams", "-select_streams", "a",
                 "-show_entries", "stream=codec_name",
                 str(output_path)],
                capture_output=True, text=True
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
        job["logs"].append({
            "ts": datetime.now().strftime("%H:%M:%S"),
            "msg": f"[ERROR] {exc}",
            "level": "err",
        })
        job["status"] = "failed"


# ── Test auth endpoint ───────────────────────────────────────

@app.get("/test-auth")
def test_auth(current_user: User = Depends(get_current_user)):
    return {
        "authenticated": True,
        "user_id": current_user.id,
        "email": current_user.email,
        "is_premium": current_user.is_premium,
    }


# ── Static files ─────────────────────────────────────────────

STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


@app.get("/auth")
def auth_page():
    return FileResponse(str(STATIC / "auth.html"))

_LEGAL_PAGES = {"terms", "privacy", "dmca"}

@app.get("/legal/{page}")
def legal_page(page: str):
    if page not in _LEGAL_PAGES:
        raise HTTPException(404)
    return FileResponse(str(STATIC / "legal" / f"{page}.html"))

@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    return FileResponse(str(STATIC / "index.html"))


# ── Entry point ──────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    print("ClipKings running at http://localhost:8080")
    uvicorn.run(app, host="0.0.0.0", port=8080, reload=False)
