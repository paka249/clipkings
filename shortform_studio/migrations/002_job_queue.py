"""Phase 3: Job queue support - add worker fields."""

MIGRATION_ID = "002"
DESCRIPTION = "Add worker_pid and result_url columns for background job tracking"


def up(conn):
    conn.executescript(
        """
        ALTER TABLE jobs ADD COLUMN worker_pid INTEGER;
        ALTER TABLE jobs ADD COLUMN result_url TEXT;
        ALTER TABLE exports ADD COLUMN worker_pid INTEGER;
        """
    )


def down(conn):
    # SQLite doesn't support DROP COLUMN easily, recreate tables
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS jobs_new (
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

        INSERT INTO jobs_new SELECT id, user_id, project_id, job_type, status, progress, error_message, created_at, started_at, finished_at FROM jobs;
        DROP TABLE jobs;
        ALTER TABLE jobs_new RENAME TO jobs;

        CREATE TABLE IF NOT EXISTS exports_new (
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

        INSERT INTO exports_new SELECT id, user_id, project_id, job_id, output_path, file_size_bytes, duration_seconds, status, created_at FROM exports;
        DROP TABLE exports;
        ALTER TABLE exports_new RENAME TO exports;
        """
    )