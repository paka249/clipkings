from __future__ import annotations

import json
import uuid
from pathlib import Path

from .db import db_session, fetch_all, fetch_one, utc_now


def list_projects(user_id: str) -> list[dict]:
    rows = fetch_all(
        """
        SELECT id, user_id, name, primary_url, bg_url, template_key, status, created_at, updated_at
        FROM projects
        WHERE user_id = ?
        ORDER BY updated_at DESC
        """,
        (user_id,),
    )
    return [dict(row) for row in rows]


def get_project(project_id: str, user_id: str) -> dict | None:
    row = fetch_one(
        """
        SELECT id, user_id, name, primary_url, bg_url, template_key, status, created_at, updated_at
        FROM projects
        WHERE id = ? AND user_id = ?
        """,
        (project_id, user_id),
    )
    if row is None:
        return None
    project = dict(row)
    project["clips"] = list_project_clips(project_id)
    return project


def list_project_clips(project_id: str) -> list[dict]:
    rows = fetch_all(
        """
        SELECT sort_order, start_ts, end_ts
        FROM project_clips
        WHERE project_id = ?
        ORDER BY sort_order ASC
        """,
        (project_id,),
    )
    return [{"start": row["start_ts"], "end": row["end_ts"], "sort_order": row["sort_order"]} for row in rows]


def create_project(
    user_id: str,
    name: str,
    primary_url: str = "",
    bg_url: str = "",
    template_key: str = "center_crop",
    clips: list[dict] | None = None,
) -> str:
    project_id = str(uuid.uuid4())
    now = utc_now()
    with db_session() as conn:
        conn.execute(
            """
            INSERT INTO projects (id, user_id, name, primary_url, bg_url, template_key, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (project_id, user_id, name, primary_url, bg_url, template_key, "draft", now, now),
        )
        if clips:
            save_project_clips(conn, project_id, clips)
    return project_id


def update_project(
    project_id: str,
    user_id: str,
    name: str,
    primary_url: str,
    bg_url: str,
    template_key: str,
    clips: list[dict],
    status: str = "draft",
) -> None:
    now = utc_now()
    with db_session() as conn:
        conn.execute(
            """
            UPDATE projects
            SET name = ?, primary_url = ?, bg_url = ?, template_key = ?, status = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (name, primary_url, bg_url, template_key, status, now, project_id, user_id),
        )
        conn.execute("DELETE FROM project_clips WHERE project_id = ?", (project_id,))
        save_project_clips(conn, project_id, clips)


def save_project_clips(conn, project_id: str, clips: list[dict]) -> None:
    now = utc_now()
    for sort_order, clip in enumerate(clips):
        conn.execute(
            """
            INSERT INTO project_clips (id, project_id, sort_order, start_ts, end_ts, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), project_id, sort_order, clip["start"], clip["end"], now),
        )


def ensure_default_project(user_id: str) -> str:
    existing = fetch_one("SELECT id FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1", (user_id,))
    if existing:
        return existing["id"]
    return create_project(user_id, "My First Project")


def record_export(
    user_id: str,
    project_id: str,
    output_path: Path,
    file_size_bytes: int,
    duration_seconds: float,
    job_id: str | None = None,
) -> str:
    export_id = str(uuid.uuid4())
    with db_session() as conn:
        conn.execute(
            """
            INSERT INTO exports (id, user_id, project_id, job_id, output_path, file_size_bytes, duration_seconds, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (export_id, user_id, project_id, job_id, str(output_path), file_size_bytes, duration_seconds, "completed", utc_now()),
        )
    return export_id


def delete_export(export_id: str, user_id: str) -> str | None:
    """Remove an export record and return its file path so the caller can delete the file."""
    row = fetch_one(
        "SELECT output_path FROM exports WHERE id = ? AND user_id = ?",
        (export_id, user_id),
    )
    if row is None:
        return None
    with db_session() as conn:
        conn.execute("DELETE FROM exports WHERE id = ? AND user_id = ?", (export_id, user_id))
    return row["output_path"]


def list_exports(user_id: str) -> list[dict]:
    rows = fetch_all(
        """
        SELECT id, project_id, job_id, output_path, file_size_bytes, duration_seconds, status, created_at
        FROM exports
        WHERE user_id = ?
        ORDER BY created_at DESC
        """,
        (user_id,),
    )
    return [dict(row) for row in rows]


def create_job(user_id: str, project_id: str, job_type: str = "render") -> str:
    job_id = str(uuid.uuid4())
    with db_session() as conn:
        conn.execute(
            """
            INSERT INTO jobs (id, user_id, project_id, job_type, status, progress, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (job_id, user_id, project_id, job_type, "queued", 0, utc_now()),
        )
    return job_id


def update_job(job_id: str, status: str, progress: int | None = None, error_message: str | None = None) -> None:
    assignments = ["status = ?"]
    params: list = [status]
    if progress is not None:
        assignments.append("progress = ?")
        params.append(progress)
    if error_message is not None:
        assignments.append("error_message = ?")
        params.append(error_message)
    if status == "running":
        assignments.append("started_at = COALESCE(started_at, ?)")
        params.append(utc_now())
    if status in {"completed", "failed"}:
        assignments.append("finished_at = ?")
        params.append(utc_now())
    params.append(job_id)
    with db_session() as conn:
        conn.execute(f"UPDATE jobs SET {', '.join(assignments)} WHERE id = ?", tuple(params))


def list_jobs(user_id: str, limit: int = 20) -> list[dict]:
    rows = fetch_all(
        """
        SELECT id, project_id, job_type, status, progress, error_message, created_at, started_at, finished_at
        FROM jobs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (user_id, limit),
    )
    return [dict(row) for row in rows]
