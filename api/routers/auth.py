import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shortform_studio.auth import authenticate_user, create_user, get_user
from shortform_studio.db import db_session, execute as db_execute, fetch_one, utc_now

router = APIRouter()


class RegisterReq(BaseModel):
    email: str
    password: str
    username: str | None = None


class LoginReq(BaseModel):
    identifier: str
    password: str


def _create_session(user_id: str) -> str:
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


def get_user_from_token(token: str | None):
    if not token:
        return None
    now = datetime.utcnow().isoformat(timespec="seconds")
    row = fetch_one(
        "SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?",
        (token, now),
    )
    return get_user(row["user_id"]) if row else None


@router.post("/api/auth/register")
def api_register(req: RegisterReq):
    if not req.email or not req.password:
        raise HTTPException(400, detail="Email and password are required")
    if len(req.password) < 8:
        raise HTTPException(400, detail="Password must be at least 8 characters")
    try:
        user = create_user(req.email.strip(), req.password, req.username)
    except Exception as exc:
        msg = str(exc)
        detail = (
            "An account with that email or username already exists"
            if "UNIQUE" in msg
            else "Registration failed — check your details and try again"
        )
        raise HTTPException(400, detail=detail)
    token = _create_session(user.id)
    return {"token": token, "user": {"id": user.id, "email": user.email, "username": user.username}}


@router.post("/api/auth/login")
def api_login(req: LoginReq):
    user = authenticate_user(req.identifier.strip(), req.password)
    if not user:
        raise HTTPException(401, detail="Incorrect email/username or password")
    token = _create_session(user.id)
    return {"token": token, "user": {"id": user.id, "email": user.email, "username": user.username}}


@router.post("/api/auth/logout")
def api_logout(request: Request):
    token = _token_from_request(request)
    if token:
        db_execute("DELETE FROM sessions WHERE token = ?", (token,))
    return {"ok": True}


@router.get("/api/auth/me")
def api_me(request: Request):
    token = _token_from_request(request)
    user = get_user_from_token(token)
    if not user:
        raise HTTPException(401, detail="Not authenticated")
    return {"id": user.id, "email": user.email, "username": user.username}
