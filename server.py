"""
ClipKings — FastAPI backend.
Run:  python server.py
Open: http://localhost:8080
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from api.database import Base, engine
from api.dependencies import get_current_user
from api.routers import ai_studio, auth, editor, exports, jobs, ranking, uploads
from shortform_studio.auth import AuthUser
from shortform_studio.config import EXPORTS_DIR, UPLOADS_DIR
from shortform_studio.db import init_db

app = FastAPI(title="ClipKings")

Path(__file__).parent.joinpath("data").mkdir(exist_ok=True)
Base.metadata.create_all(bind=engine)

app.include_router(auth.router)
app.include_router(uploads.router)
app.include_router(exports.router)
app.include_router(jobs.router)
app.include_router(ranking.router)
app.include_router(ai_studio.router)
app.include_router(editor.router)

# ── Static files & templates ─────────────────────────────────

STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


@app.get("/auth")
def auth_page():
    return FileResponse(str(STATIC / "auth.html"))


_LEGAL_PAGES = {"terms", "privacy", "dmca"}


@app.get("/legal/{page}")
def legal_page(page: str):
    if page not in _LEGAL_PAGES:
        raise HTTPException(404)
    return FileResponse(str(STATIC / "legal" / f"{page}.html"))


@app.get("/test-auth")
def test_auth(current_user: AuthUser = Depends(get_current_user)):
    return {
        "authenticated": True,
        "user_id": current_user.id,
        "email": current_user.email,
        "username": current_user.username,
    }


@app.get("/{full_path:path}")
def spa_fallback(request: Request, full_path: str):
    return templates.TemplateResponse("index.html", {"request": request})


# ── Entry point ──────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    print("ClipKings running at http://localhost:8080")
    uvicorn.run(app, host="0.0.0.0", port=8080, reload=False)
