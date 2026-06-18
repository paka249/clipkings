# Short-Form Studio Web Plan

## What is implemented now
- Local Streamlit UI for ingesting video URLs, building clip timelines, rendering FFmpeg exports, and downloading MP4s.
- SQLite-backed authentication and project storage scaffold.
- Persistent project/export/job tables.
- Top-level layout pieces for nav, profile, and ad slots.

## What still needs a true production backend
- Separate FastAPI app for auth and project APIs.
- Background render worker with a queue such as RQ or Celery.
- Object storage for uploads and exports.
- Managed PostgreSQL in production.

## Suggested roadmap
1. Wire the Streamlit UI to the SQLite auth/project layer.
2. Add sign up / login / logout.
3. Persist projects, clips, and export history per user.
4. Add a real job queue and worker for FFmpeg.
5. Move from SQLite to PostgreSQL and local files to S3.
6. Add ads once traffic and policy requirements are ready.
