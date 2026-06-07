-- ============================================================
-- Home Soil 2026 — Fan engagement features schema
-- (Match Center, Pick'em + Leaderboard). Run in Supabase → SQL Editor.
-- Safe to re-run.
-- ============================================================

-- ---------- MATCHES (cached from the football data API) ----------
-- The storefront reads from this table (never the API directly) so the Match
-- Center always has data even if the upstream API is rate-limited or down.
CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,          -- provider match id
  utc_date    TIMESTAMPTZ,
  matchday    INTEGER,
  stage       TEXT,                       -- GROUP_STAGE | ROUND_OF_16 | QUARTER_FINALS | SEMI_FINALS | THIRD_PLACE | FINAL
  group_name  TEXT,                       -- e.g. "Group A" (null for knockouts)
  home        TEXT,
  away        TEXT,
  home_code   TEXT,                       -- 3-letter (USA, MEX…)
  away_code   TEXT,
  home_flag   TEXT,                       -- crest/flag url
  away_flag   TEXT,
  home_score  INTEGER,
  away_score  INTEGER,
  status      TEXT,                       -- SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED
  winner      TEXT,                       -- HOME_TEAM | AWAY_TEAM | DRAW | null
  venue       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read matches" ON matches FOR SELECT USING (true);
-- Writes are service-role only (the /api/matches refresh), so no write policy.

CREATE INDEX IF NOT EXISTS idx_matches_utc_date ON matches (utc_date);

-- A tiny key/value table to remember when we last refreshed from the API, so a
-- burst of visitors doesn't hammer the upstream rate limit.
CREATE TABLE IF NOT EXISTS app_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;  -- service-role only

-- ---------- PREDICTIONS (Pick'em entries + leaderboard) ----------
CREATE TABLE IF NOT EXISTS predictions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT UNIQUE NOT NULL,     -- one entry per email
  display_name   TEXT NOT NULL,
  picks          JSONB NOT NULL DEFAULT '{}',  -- { "<matchId>": "HOME_TEAM"|"DRAW"|"AWAY_TEAM" }
  points         INTEGER NOT NULL DEFAULT 0,
  correct        INTEGER NOT NULL DEFAULT 0,
  scored_at      TIMESTAMPTZ,
  marketing_opt_in BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
-- No public policies: entries are written/read via the service role (the API).
-- The leaderboard is served by /api/predictions and exposes only name + points.

-- ---------- MIGRATIONS (safe to re-run) ----------
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN DEFAULT FALSE;
