# ClipKings — Backend Architecture

## Overview

ClipKings is a **local-first video processing platform**. The backend is a FastAPI Python application that shells out to FFmpeg for all media work. No cloud dependency — everything runs on your machine.

---

## Request Flow

```
Browser
  └─► FastAPI (server.py  ·  uvicorn)
        ├─► api/routers/auth.py        — register · login · logout · /me
        ├─► api/routers/uploads.py     — upload · list · stream · delete
        ├─► api/routers/exports.py     — list · download · delete renders
        ├─► api/routers/jobs.py        — job status polling
        ├─► api/routers/editor.py      — video editor render
        ├─► api/routers/ranking.py     — ranking video generate
        ├─► api/routers/ai_studio.py   — AI studio generate
        ├─► api/routers/jobs.py        — clip studio generate + status
        └─► shortform_studio/          — core FFmpeg processing library
```

---

## Authentication

| Concept | Detail |
|---------|--------|
| Token type | Opaque UUID4 — not JWT |
| Storage | `sessions` table in SQLite; deleted on logout |
| Lifetime | 30 days |
| Wire format | `Authorization: Bearer <token>` header |
| Password hashing | PBKDF2-SHA256 · 210 000 rounds · random 16-byte salt per user (NIST 2024 compliant) |
| Rate limiting | In-memory: 5 login/register attempts per IP per 60 s → HTTP 429 + `Retry-After` header |
| Enforced by | `get_current_user` dependency in `api/dependencies.py` — add `Depends(get_current_user)` to any route that needs auth |

**Why opaque tokens instead of JWT?**
JWT encodes claims inside the token — you can't invalidate one without a blocklist, which defeats the point. Opaque tokens are random IDs: delete the row in `sessions` on logout and the token is immediately dead.

---

## Databases

### Primary — `app_data/shortform_studio.sqlite3`

Raw `sqlite3` module (no ORM). Managed by `shortform_studio/db.py`.

| Table | Columns (key ones) |
|-------|--------------------|
| `users` | id · email · username · password_salt · password_hash · created_at |
| `sessions` | token · user_id · expires_at |
| `profiles` | display settings per user |
| `projects` | saved editor projects |
| `jobs` | background render job records |
| `exports` | completed render metadata |

### Secondary — `data/app.db`

SQLAlchemy ORM. Managed by `api/database.py`. Currently holds a `users` table with `is_premium` and Stripe fields. This is where billing state will live when you add Stripe webhooks — leave it alone for now.

---

## File Storage

```
uploads/
  index.json        ← [{id, name, ext, size_mb, duration, is_audio, path, uploaded_at}]
  abc12345.mp4
  def67890.mp3
  ...

exports/
  short_crop_20260101_120000.mp4
  ...
```

`index.json` is the upload manifest — faster than `os.listdir` on every request. `load_uploads()` / `save_uploads()` in `api/routers/state.py` manage it.

---

## Media Processing

FFmpeg is called via `subprocess.run()`. Jobs are long-running — the browser polls `GET /api/jobs/{id}` every second until `status` is `done` or `error`.

| Route | Operation |
|-------|-----------|
| `POST /api/generate` | Clip Studio render (concat + optional split-screen) |
| `POST /api/generate/ranking` | Ranking bar-chart video |
| `POST /api/generate/ai-studio` | Subtitles + voiceover via Whisper / TTS |
| `POST /api/edit/render` | Video Editor timeline render |
| `POST /api/preview` | FFprobe metadata (title · duration · thumbnail) |

Job state lives in `_jobs` dict in `api/routers/state.py` — in-memory, resets on server restart. Move to the `jobs` SQLite table if you need durability across restarts.

---

## Frontend Auth Flow

```
auth.html                         server
  │  POST /api/auth/register ───► validate · hash password · insert user + session
  │  POST /api/auth/login    ───► hash candidate · compare · return {token, user}
  │
  │  localStorage.setItem('sf-auth-token', token)
  │
main app (auth.js → apiFetch)
  │  GET  /api/auth/me ──────────► validate token → return {username, email}
  │  POST /api/auth/logout ──────► delete session row → 204
  │
  │  Every /api/* call goes through apiFetch():
  │    • adds Authorization: Bearer <token> automatically
  │    • on 401 → clears token + redirects to /auth
```

---

## What Needs Doing Before Production

1. **HTTPS** — tokens travel in headers; everything above is worthless over plain HTTP. Run behind nginx or Caddy with TLS.
2. **Protect routes** — add `Depends(get_current_user)` to any route that should require login. Currently all `/api/` routes are public (auth endpoints are always public).
3. **SECRET_KEY** — store a random secret in `.env` and load it via `python-dotenv`. Use it to HMAC-sign session tokens as an extra layer (UUID4 is already 122 bits of entropy, so this is defence-in-depth).
4. **Stripe** — `api/models.py` has `is_premium` ready. Wire a `/api/stripe/webhook` handler to flip it when a subscription activates.
5. **Job persistence** — `_jobs` is in-memory. Move to SQLite `jobs` table to survive restarts.
