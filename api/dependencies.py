"""
FastAPI dependency: get the authenticated user from the Bearer token.

Every protected route does:
    current_user: AuthUser = Depends(get_current_user)

The token is an opaque UUID4 stored in the `sessions` table (shortform_studio DB).
On each request we look it up, check expiry, and return the AuthUser.
If the token is missing, expired, or invalid → 401.
"""
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from shortform_studio.auth import AuthUser, get_user
from shortform_studio.db import fetch_one

# auto_error=False so we return 401 with our own message instead of FastAPI's default 403
_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthUser:
    token = credentials.credentials if credentials else None
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    row = fetch_one(
        "SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?",
        (token, now),
    )
    if not row:
        raise HTTPException(status_code=401, detail="Session expired or invalid — please log in again")

    user = get_user(row["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="Account not found")

    return user
