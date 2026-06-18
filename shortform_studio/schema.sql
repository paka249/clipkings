-- Short-Form Studio — Supabase PostgreSQL Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Row Level Security (RLS) is enabled on every table so users
-- can ONLY read/write their own data — not anyone else's.

-- ── Profiles ─────────────────────────────────────────────────────────────────
-- Extends Supabase's built-in auth.users table with app-specific fields.
CREATE TABLE IF NOT EXISTS profiles (
    id              UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    username        TEXT UNIQUE,
    display_name    TEXT,
    bio             TEXT DEFAULT '',
    avatar_url      TEXT,
    settings_json   JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile read"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- ── Projects ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name            TEXT NOT NULL DEFAULT 'Untitled Project',
    primary_url     TEXT DEFAULT '',
    bg_url          TEXT DEFAULT '',
    template_key    TEXT DEFAULT 'center_crop',
    clips_json      JSONB DEFAULT '[]',
    status          TEXT DEFAULT 'draft',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own projects"
    ON projects FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ── Exports ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exports (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
    output_path         TEXT NOT NULL,
    file_size_bytes     BIGINT DEFAULT 0,
    duration_secs       REAL DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own exports read"   ON exports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own exports insert" ON exports FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── Jobs ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
    job_type        TEXT DEFAULT 'render',
    status          TEXT DEFAULT 'pending',   -- pending | running | completed | failed
    progress        INT DEFAULT 0,
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own jobs"
    ON jobs FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ── Auto-update updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER jobs_updated_at     BEFORE UPDATE ON jobs     FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Storage buckets ───────────────────────────────────────────────────────────
-- Create these manually in: Supabase Dashboard → Storage → New Bucket
--   Name: "avatars"   | Public: NO | File size limit: 5MB
--   Name: "exports"   | Public: NO | File size limit: 500MB
--
-- Then add storage policies so users can only access their own files:
--   avatars: allow INSERT/SELECT where (storage.foldername(name))[1] = auth.uid()::text
--   exports: same pattern
