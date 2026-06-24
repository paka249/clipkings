import subprocess

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from shortform_studio.config import BG_TEMPLATES_DIR, EXPORTS_DIR
from shortform_studio.yt import extract_stream_url

from .state import _BG_VALID

router = APIRouter()


class PreviewReq(BaseModel):
    url: str


@router.post("/api/preview")
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


@router.get("/api/exports")
def api_exports():
    all_files = [*EXPORTS_DIR.glob("*.mp4"), *EXPORTS_DIR.glob("*.webm")]
    return [
        {"name": f.name, "size_mb": round(f.stat().st_size / 1_000_000, 1)}
        for f in sorted(all_files, key=lambda x: x.stat().st_mtime, reverse=True)
    ]


@router.delete("/api/exports/{filename:path}")
def api_delete_export(filename: str):
    path = (EXPORTS_DIR / filename).resolve()
    if not str(path).startswith(str(EXPORTS_DIR.resolve())):
        raise HTTPException(400, detail="Invalid path")
    if not path.exists():
        raise HTTPException(404, detail="File not found")
    path.unlink()
    return {"deleted": filename}


@router.get("/api/download/{filename}")
def api_download(filename: str):
    path = EXPORTS_DIR / filename
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(
        str(path), media_type="video/mp4", filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/video/{filename}")
def api_video(filename: str):
    path = EXPORTS_DIR / filename
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(str(path), media_type="video/mp4")


@router.get("/api/bg-templates")
def api_bg_templates():
    result = []
    for name in sorted(_BG_VALID):
        path = BG_TEMPLATES_DIR / f"{name}.mp4"
        result.append({"name": name, "ready": path.exists()})
    return result


@router.get("/api/bg-video/{name}")
def api_bg_video(name: str):
    if name not in _BG_VALID:
        raise HTTPException(404)
    path = BG_TEMPLATES_DIR / f"{name}.mp4"
    if not path.exists():
        raise HTTPException(404, detail="Gaming template video not downloaded yet — run download_bg_templates.py")
    return FileResponse(str(path), media_type="video/mp4")


@router.get("/api/bg-thumb/{slug}")
def api_bg_thumb(slug: str):
    if slug not in _BG_VALID:
        raise HTTPException(404)
    video_path = BG_TEMPLATES_DIR / f"{slug}.mp4"
    if not video_path.exists():
        raise HTTPException(404, detail="Video not downloaded yet")
    thumb_path = BG_TEMPLATES_DIR / f"{slug}_thumb.jpg"
    if not thumb_path.exists():
        subprocess.run(
            ["ffmpeg", "-y", "-ss", "3", "-i", str(video_path),
             "-vframes", "1", "-q:v", "2", str(thumb_path)],
            check=True, capture_output=True,
        )
    return FileResponse(str(thumb_path), media_type="image/jpeg")
