"""Session tokens table for auth."""

MIGRATION_ID = "003"
DESCRIPTION = "Add sessions table for bearer-token authentication"


def up(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            token      TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    """)


def down(conn):
    conn.executescript("DROP TABLE IF EXISTS sessions;")
