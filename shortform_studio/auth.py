from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass

from .db import execute, fetch_one, get_connection, init_db, utc_now, db_session

PBKDF2_ROUNDS = 210_000


@dataclass
class AuthUser:
    id: str
    email: str
    username: str
    avatar_url: str | None
    created_at: str


def hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return salt.hex(), derived.hex()


def verify_password(password: str, salt_hex: str, expected_hash_hex: str) -> bool:
    _, candidate_hash = hash_password(password, salt_hex)
    return hmac.compare_digest(candidate_hash, expected_hash_hex)


def _username_from_email(email: str) -> str:
    base = email.split("@", 1)[0].strip().lower()
    return base.replace(" ", "_") or "user"


def create_user(email: str, password: str, username: str | None = None) -> AuthUser:
    init_db()
    email = email.strip().lower()
    username = (username or _username_from_email(email)).strip().lower()
    salt_hex, hash_hex = hash_password(password)
    user_id = str(uuid.uuid4())
    avatar_url = None
    created_at = utc_now()

    with db_session() as conn:
        conn.execute(
            """
            INSERT INTO users (id, email, username, password_salt, password_hash, avatar_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, email, username, salt_hex, hash_hex, avatar_url, created_at),
        )
        conn.execute(
            """
            INSERT INTO profiles (user_id, display_name, bio, settings_json)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, username, "", "{}"),
        )

    return AuthUser(id=user_id, email=email, username=username, avatar_url=avatar_url, created_at=created_at)


def authenticate_user(identifier: str, password: str) -> AuthUser | None:
    init_db()
    identifier = identifier.strip().lower()
    row = fetch_one(
        """
        SELECT id, email, username, password_salt, password_hash, avatar_url, created_at
        FROM users
        WHERE email = ? OR username = ?
        """,
        (identifier, identifier),
    )
    if row is None:
        return None

    if not verify_password(password, row["password_salt"], row["password_hash"]):
        return None

    with db_session() as conn:
        conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (utc_now(), row["id"]))

    return AuthUser(
        id=row["id"],
        email=row["email"],
        username=row["username"],
        avatar_url=row["avatar_url"],
        created_at=row["created_at"],
    )


def get_user(user_id: str) -> AuthUser | None:
    row = fetch_one(
        """
        SELECT id, email, username, avatar_url, created_at
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    )
    if row is None:
        return None
    return AuthUser(
        id=row["id"],
        email=row["email"],
        username=row["username"],
        avatar_url=row["avatar_url"],
        created_at=row["created_at"],
    )


def get_profile(user_id: str) -> dict | None:
    row = fetch_one(
        """
        SELECT user_id, display_name, bio, settings_json
        FROM profiles
        WHERE user_id = ?
        """,
        (user_id,),
    )
    if row is None:
        return None
    return dict(row)


def update_profile(user_id: str, display_name: str, bio: str, settings_json: str = "{}") -> None:
    with db_session() as conn:
        conn.execute(
            """
            UPDATE profiles
            SET display_name = ?, bio = ?, settings_json = ?
            WHERE user_id = ?
            """,
            (display_name, bio, settings_json, user_id),
        )


def update_avatar_url(user_id: str, avatar_url: str | None) -> None:
    with db_session() as conn:
        conn.execute("UPDATE users SET avatar_url = ? WHERE id = ?", (avatar_url, user_id))


def avatar_initial(user: AuthUser | None) -> str:
    if user is None:
        return "?"
    return (user.username[:1] or user.email[:1] or "?").upper()


LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001"
LOCAL_USER_EMAIL = "local@studio.local"
LOCAL_USER_NAME = "local"


def get_or_create_local_user() -> AuthUser:
    """Return the default local (no-login) user, creating it if needed."""
    init_db()
    row = fetch_one("SELECT id, email, username, avatar_url, created_at FROM users WHERE id = ?", (LOCAL_USER_ID,))
    if row:
        return AuthUser(id=row["id"], email=row["email"], username=row["username"],
                        avatar_url=row["avatar_url"], created_at=row["created_at"])

    salt_hex, hash_hex = hash_password("__local__")
    now = utc_now()
    with db_session() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO users (id, email, username, password_salt, password_hash, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (LOCAL_USER_ID, LOCAL_USER_EMAIL, LOCAL_USER_NAME, salt_hex, hash_hex, None, now),
        )
        conn.execute(
            "INSERT OR IGNORE INTO profiles (user_id, display_name, bio, settings_json) VALUES (?, ?, ?, ?)",
            (LOCAL_USER_ID, "Local User", "", "{}"),
        )
    return AuthUser(id=LOCAL_USER_ID, email=LOCAL_USER_EMAIL, username=LOCAL_USER_NAME, avatar_url=None, created_at=now)
