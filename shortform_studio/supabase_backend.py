"""
Supabase backend — drop-in cloud replacement for the local SQLite stack.

SETUP (3 steps):
  1. pip install supabase python-dotenv
  2. Copy .env.example → .env and fill in your project credentials
  3. Run schema.sql in the Supabase SQL editor (Dashboard → SQL Editor)

Once USE_SUPABASE=True (auto-detected when env vars are present), this module
provides the same function signatures as auth.py and projects.py so app.py
needs zero changes — just swap the imports.
"""

from __future__ import annotations

from functools import lru_cache
from dataclasses import dataclass

from .config import SUPABASE_URL, SUPABASE_ANON_KEY, USE_SUPABASE


@lru_cache(maxsize=1)
def get_client():
    """Return a cached Supabase client. Raises clearly if misconfigured."""
    if not USE_SUPABASE:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file."
        )
    try:
        from supabase import create_client
    except ImportError:
        raise RuntimeError("Run: pip install supabase")

    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


# ── Auth ─────────────────────────────────────────────────────────────────────

@dataclass
class AuthUser:
    id: str
    email: str
    username: str
    avatar_url: str | None
    created_at: str


def sign_up(email: str, password: str, username: str | None = None) -> AuthUser:
    """Create a new user via Supabase Auth + insert a profile row."""
    client = get_client()
    resp = client.auth.sign_up({"email": email, "password": password})

    user = resp.user
    if user is None:
        raise ValueError("Sign-up failed — check your Supabase email confirmation settings.")

    uname = (username or email.split("@")[0]).strip().lower()
    client.table("profiles").insert({
        "id": user.id,
        "username": uname,
        "display_name": uname,
        "bio": "",
        "settings_json": {},
    }).execute()

    return AuthUser(
        id=user.id,
        email=user.email,
        username=uname,
        avatar_url=None,
        created_at=str(user.created_at),
    )


def sign_in(email: str, password: str) -> tuple[AuthUser, str] | None:
    """
    Authenticate a user. Returns (AuthUser, access_token) or None on failure.
    Store the access_token in st.session_state["sb_token"] to make
    authenticated requests on behalf of the user.
    """
    client = get_client()
    try:
        resp = client.auth.sign_in_with_password({"email": email, "password": password})
    except Exception:
        return None

    user = resp.user
    session = resp.session
    if user is None or session is None:
        return None

    profile = get_profile(user.id)
    uname = (profile or {}).get("username") or email.split("@")[0]

    auth_user = AuthUser(
        id=user.id,
        email=user.email,
        username=uname,
        avatar_url=(profile or {}).get("avatar_url"),
        created_at=str(user.created_at),
    )
    return auth_user, session.access_token


def sign_out() -> None:
    client = get_client()
    client.auth.sign_out()


def get_user_by_id(user_id: str) -> AuthUser | None:
    """Fetch a user record from the profiles table."""
    client = get_client()
    resp = client.table("profiles").select("id, username, display_name, avatar_url, created_at").eq("id", user_id).single().execute()
    row = resp.data
    if not row:
        return None
    return AuthUser(
        id=row["id"],
        email="",  # email lives in auth.users, not exposed via anon key
        username=row.get("username", ""),
        avatar_url=row.get("avatar_url"),
        created_at=row.get("created_at", ""),
    )


def get_profile(user_id: str) -> dict | None:
    client = get_client()
    resp = client.table("profiles").select("*").eq("id", user_id).single().execute()
    return resp.data or None


def update_profile(user_id: str, display_name: str, bio: str) -> None:
    client = get_client()
    client.table("profiles").update({"display_name": display_name, "bio": bio}).eq("id", user_id).execute()


def update_avatar_url(user_id: str, avatar_url: str | None) -> None:
    client = get_client()
    client.table("profiles").update({"avatar_url": avatar_url}).eq("id", user_id).execute()


# ── Projects ──────────────────────────────────────────────────────────────────

def list_projects_sb(user_id: str) -> list[dict]:
    client = get_client()
    resp = client.table("projects").select("*").eq("user_id", user_id).order("updated_at", desc=True).execute()
    return resp.data or []


def create_project_sb(user_id: str, name: str, primary_url: str = "", bg_url: str = "",
                      template_key: str = "center_crop", clips: list | None = None) -> str:
    client = get_client()
    resp = client.table("projects").insert({
        "user_id": user_id,
        "name": name,
        "primary_url": primary_url,
        "bg_url": bg_url,
        "template_key": template_key,
        "clips_json": clips or [],
    }).execute()
    return resp.data[0]["id"]


def update_project_sb(project_id: str, user_id: str, name: str, primary_url: str,
                      bg_url: str, template_key: str, clips: list) -> None:
    client = get_client()
    client.table("projects").update({
        "name": name,
        "primary_url": primary_url,
        "bg_url": bg_url,
        "template_key": template_key,
        "clips_json": clips,
    }).eq("id", project_id).eq("user_id", user_id).execute()


# ── Exports ───────────────────────────────────────────────────────────────────

def record_export_sb(user_id: str, project_id: str, output_path: str,
                     file_size_bytes: int, duration_secs: float) -> str:
    client = get_client()
    resp = client.table("exports").insert({
        "user_id": user_id,
        "project_id": project_id,
        "output_path": output_path,
        "file_size_bytes": file_size_bytes,
        "duration_secs": duration_secs,
    }).execute()
    return resp.data[0]["id"]


def list_exports_sb(user_id: str) -> list[dict]:
    client = get_client()
    resp = client.table("exports").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(20).execute()
    return resp.data or []
