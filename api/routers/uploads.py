import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from shortform_studio.config import UPLOADS_DIR
from shortform_studio.probe import file_duration

from .state import (
    _ALLOWED_AUDIO_EXTS,
    _ALLOWED_EXTS,
    _ALLOWED_IMAGE_EXTS,
    _MAX_LIBRARY_SIZE,
    _MAX_UPLOAD_MB,
    load_uploads,
    save_uploads,
)

router = APIRouter()


@router.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if not ext:
        ct = (file.content_type or "").split(";")[0].strip()
        ct_map = {
            "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
            "video/x-matroska": ".mkv", "video/x-msvideo": ".avi",
            "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/wav": ".wav",
            "audio/ogg": ".ogg", "audio/aac": ".aac",
            "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
            "image/gif": ".gif", "image/avif": ".avif",
        }
        ext = ct_map.get(ct, "")
        # Fall back to any image/* content type
        if not ext and (file.content_type or "").startswith("image/"):
            ext = ".jpg"
    uploads = load_uploads()
    if len(uploads) >= _MAX_LIBRARY_SIZE:
        raise HTTPException(
            400,
            detail=f"Library is full ({_MAX_LIBRARY_SIZE} files max). Delete unused files before uploading more.",
        )

    all_allowed = _ALLOWED_EXTS | _ALLOWED_AUDIO_EXTS | _ALLOWED_IMAGE_EXTS
    if ext not in all_allowed:
        raise HTTPException(
            400,
            detail=f"Unsupported file type '{ext or 'unknown'}'. "
                   f"Allowed video: {', '.join(sorted(_ALLOWED_EXTS))} — "
                   f"audio: {', '.join(sorted(_ALLOWED_AUDIO_EXTS))} — "
                   f"images: {', '.join(sorted(_ALLOWED_IMAGE_EXTS))}",
        )

    contents = await file.read()
    if len(contents) > _MAX_UPLOAD_MB * 1_000_000:
        raise HTTPException(413, detail=f"File exceeds {_MAX_UPLOAD_MB} MB limit")

    uid = str(uuid.uuid4())[:8]
    orig_name = file.filename or f"{uid}{ext}"
    dest = UPLOADS_DIR / f"{uid}{ext}"
    dest.write_bytes(contents)

    duration = None
    try:
        d = file_duration(dest)
        if d is not None:
            duration = round(d, 2)
    except Exception:
        pass

    entry = {
        "id": uid,
        "name": orig_name,
        "ext": ext,
        "size_mb": round(len(contents) / 1_000_000, 2),
        "duration": duration,
        "is_audio": ext in _ALLOWED_AUDIO_EXTS,
        "is_image": ext in _ALLOWED_IMAGE_EXTS,
        "path": str(dest),
        "uploaded_at": datetime.now().isoformat(timespec="seconds"),
    }
    uploads.append(entry)
    save_uploads(uploads)
    return entry


@router.get("/api/uploads")
def api_uploads():
    return load_uploads()


@router.get("/api/uploads/stream/{uid}")
def api_stream_upload(uid: str):
    uploads = load_uploads()
    entry = next((u for u in uploads if u["id"] == uid), None)
    if not entry:
        raise HTTPException(404)
    path = Path(entry["path"])
    if not path.exists():
        raise HTTPException(404)
    _MEDIA_TYPES = {
        ".mp4": "video/mp4", ".mov": "video/mp4", ".m4v": "video/mp4",
        ".mkv": "video/webm", ".webm": "video/webm", ".avi": "video/x-msvideo",
        ".mp3": "audio/mpeg", ".aac": "audio/aac", ".wav": "audio/wav",
        ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jfif": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
        ".avif": "image/avif",
    }
    media_type = _MEDIA_TYPES.get(entry.get("ext", ""), "application/octet-stream")
    return FileResponse(str(path), media_type=media_type)


@router.delete("/api/uploads/{uid}")
def api_delete_upload(uid: str):
    uploads = load_uploads()
    match = next((u for u in uploads if u["id"] == uid), None)
    if not match:
        raise HTTPException(404, detail="Upload not found")
    (UPLOADS_DIR / f"{uid}{match['ext']}").unlink(missing_ok=True)
    save_uploads([u for u in uploads if u["id"] != uid])
    return {"deleted": uid}
