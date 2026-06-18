"""Migration runner for SQLite database."""

from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path

DB_INIT_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL,
    last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY,
    display_name TEXT,
    bio TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    primary_url TEXT NOT NULL DEFAULT '',
    bg_url TEXT NOT NULL DEFAULT '',
    template_key TEXT NOT NULL DEFAULT 'center_crop',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_clips (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    start_ts TEXT NOT NULL,
    end_ts TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    job_id TEXT,
    output_path TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ad_slots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    placement TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
"""


migrations_path = Path(__file__).resolve().parent / "migrations"


def run_migrations():
    from datetime import datetime, timezone
    from .db import db_session, get_connection
    
    utc_now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    
    with db_session() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
            """
        )
    
    with db_session() as _conn:
        applied = {row["id"] for row in _conn.execute("SELECT id FROM schema_migrations").fetchall()}
    
    if "001" not in applied:
        with db_session() as conn:
            conn.executescript(DB_INIT_SQL)
            conn.execute(
                "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
                ("001", utc_now),
            )
            conn.execute(
                "INSERT OR IGNORE INTO ad_slots (id, name, placement, enabled, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("slot-bottom", "bottom-banner", "bottom", 0, "{}", utc_now),
            )
            conn.execute(
                "INSERT OR IGNORE INTO ad_slots (id, name, placement, enabled, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("slot-after-export", "after-export-banner", "after-export", 0, "{}", utc_now),
            )
    
    if migrations_path.exists():
        for _, name, _ in sorted(pkgutil.iter_modules([str(migrations_path)])):
            module = importlib.import_module(f".migrations.{name}", package="shortform_studio")
            migration_id = module.MIGRATION_ID
            if migration_id in applied:
                continue
            
            with db_session() as conn:
                module.up(conn)
                conn.execute(
                    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
                    (migration_id, utc_now),
                )
                if hasattr(module, "seed"):
                    module.seed(conn, utc_now)