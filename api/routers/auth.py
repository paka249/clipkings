"""
Auth routes: register, login, logout, me.

Security layers:
  1. In-memory rate limiter — 5 attempts / 60s per IP on login + register
  2. Email format validation via regex before touching the DB
  3. Passwords hashed with PBKDF2-SHA256, 210k rounds + random salt (shortform_studio/auth.py)
  4. Session tokens are opaque UUID4s stored in the DB (NOT JWTs — nothing is encoded in the token)
  5. Session expiry: 30 days; expired sessions deleted on each new login
"""

import re
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shortform_studio.auth import authenticate_user, create_user, get_user
from shortform_studio.db import db_session, execute as db_execute, fetch_one, utc_now

router = APIRouter()

# ── Email validation ──────────────────────────────────────────
_EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')

def _valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email)) and len(email) <= 254


# ── In-memory rate limiter ────────────────────────────────────
# Maps IP → list of timestamps of recent attempts.
# Simple and dependency-free; resets on server restart (fine for small projects).
_buckets: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW  = 60   # seconds
_RATE_MAX     = 5    # max attempts per window

def _rate_check(request: Request, label: str = "attempt") -> None:
    ip  = request.client.host if request.client else "unknown"
    now = time.monotonic()
    # Evict timestamps outside the window
    _buckets[ip] = [t for t in _buckets[ip] if now - t < _RATE_WINDOW]
    if len(_buckets[ip]) >= _RATE_MAX:
        retry_in = int(_RATE_WINDOW - (now - _buckets[ip][0])) + 1
        raise HTTPException(
            status_code=429,
            detail=f"Too many {label}s. Wait {retry_in}s and try again.",
            headers={"Retry-After": str(retry_in)},
        )
    _buckets[ip].append(now)


# ── Session helpers ───────────────────────────────────────────
def _create_session(user_id: str) -> str:
    """Insert a new session row and return the opaque token."""
    token   = str(uuid.uuid4())
    now     = utc_now()
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(timespec="seconds")
    with db_session() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now, expires),
        )
    return token


def _purge_expired_sessions(user_id: str) -> None:
    """Delete expired sessions for this user to keep the table tidy."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db_execute("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?", (user_id, now))


def _token_from_request(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    return token or None


# ── Request / Response schemas ────────────────────────────────
class RegisterReq(BaseModel):
    email:    str
    password: str
    username: str | None = None


class LoginReq(BaseModel):
    identifier: str   # email or username
    password:   str


# ── Routes ───────────────────────────────────────────────────

@router.post("/api/auth/register", status_code=201)
def api_register(req: RegisterReq, request: Request):
    _rate_check(request, "registration")

    email = req.email.strip().lower()
    if not _valid_email(email):
        raise HTTPException(400, detail="Invalid email address")
    if len(req.password) < 8:
        raise HTTPException(400, detail="Password must be at least 8 characters")

    try:
        user = create_user(email, req.password, req.username)
    except Exception as exc:
        msg = str(exc)
        detail = (
            "An account with that email or username already exists"
            if "UNIQUE" in msg
            else "Registration failed — please try again"
        )
        raise HTTPException(400, detail=detail)

    token = _create_session(user.id)
    return {
        "token": token,
        "user": {"id": user.id, "email": user.email, "username": user.username},
    }


@router.post("/api/auth/login")
def api_login(req: LoginReq, request: Request):
    _rate_check(request, "login")

    user = authenticate_user(req.identifier.strip(), req.password)
    if not user:
        # Same message for wrong email AND wrong password — prevents user enumeration
        raise HTTPException(401, detail="Incorrect email/username or password")

    _purge_expired_sessions(user.id)
    token = _create_session(user.id)
    return {
        "token": token,
        "user": {"id": user.id, "email": user.email, "username": user.username},
    }


@router.post("/api/auth/logout")
def api_logout(request: Request):
    token = _token_from_request(request)
    if token:
        db_execute("DELETE FROM sessions WHERE token = ?", (token,))
    return {"ok": True}


@router.get("/api/auth/me")
def api_me(request: Request):
    token = _token_from_request(request)
    if not token:
        raise HTTPException(401, detail="Not authenticated")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    row = fetch_one(
        "SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?",
        (token, now),
    )
    if not row:
        raise HTTPException(401, detail="Session expired — please log in again")
    user = get_user(row["user_id"])
    if not user:
        raise HTTPException(401, detail="Account not found")
    return {"id": user.id, "email": user.email, "username": user.username}
