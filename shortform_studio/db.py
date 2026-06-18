from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .config import PROJECT_ROOT
from .migrate import run_migrations

APP_DATA_DIR = PROJECT_ROOT / "app_data"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = APP_DATA_DIR / "shortform_studio.sqlite3"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db_session() -> Iterator[sqlite3.Connection]:
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    run_migrations()


def fetch_one(query: str, params: tuple = ()) -> sqlite3.Row | None:
    with db_session() as conn:
        return conn.execute(query, params).fetchone()


def fetch_all(query: str, params: tuple = ()) -> list[sqlite3.Row]:
    with db_session() as conn:
        return conn.execute(query, params).fetchall()


def execute(query: str, params: tuple = ()) -> int:
    with db_session() as conn:
        cursor = conn.execute(query, params)
        return cursor.rowcount

