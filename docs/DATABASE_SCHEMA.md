# Database Schema

This is the production-oriented schema the app is being moved toward.

Schema migrations are managed in `shortform_studio/migrate.py` and `shortform_studio/migrations/`.
Each migration file must define `MIGRATION_ID` and `up(conn)` functions.

## users
- id (UUID, PK)
- email (unique)
- username (unique)
- password_salt
- password_hash
- avatar_url
- created_at
- last_login_at

## profiles
- user_id (PK, FK -> users.id)
- display_name
- bio
- settings_json

## projects
- id (UUID, PK)
- user_id (FK -> users.id)
- name
- primary_url
- bg_url
- template_key
- status
- created_at
- updated_at

## project_clips
- id (UUID, PK)
- project_id (FK -> projects.id)
- sort_order
- start_ts
- end_ts
- created_at

## jobs
- id (UUID, PK)
- user_id (FK -> users.id)
- project_id (FK -> projects.id)
- job_type
- status
- progress
- error_message
- created_at
- started_at
- finished_at

## exports
- id (UUID, PK)
- user_id (FK -> users.id)
- project_id (FK -> projects.id)
- job_id (nullable FK -> jobs.id)
- output_path
- file_size_bytes
- duration_seconds
- status
- created_at

## ad_slots
- id (UUID or stable string, PK)
- name (unique)
- placement
- enabled
- config_json
- created_at
