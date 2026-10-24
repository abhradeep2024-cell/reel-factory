-- Reel Factory - initial schema (D1 / SQLite)
-- All timestamps are ISO-8601 UTC strings, e.g. 2026-10-25T09:30:00.000Z
-- Week model: a script submitted on Sunday covers the FOLLOWING Monday..Sunday week.
-- week_start is always the Monday of the covered week (YYYY-MM-DD in Asia/Kolkata).

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS scripts (
  id             TEXT PRIMARY KEY,
  week_start     TEXT NOT NULL UNIQUE,
  title          TEXT,
  content        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'submitted',
  analysis       TEXT,
  prompt_version TEXT,
  submitted_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reels (
  id             TEXT PRIMARY KEY,
  script_id      TEXT NOT NULL REFERENCES scripts(id),
  week_start     TEXT NOT NULL,
  day_index      INTEGER NOT NULL,
  title          TEXT NOT NULL,
  concept        TEXT NOT NULL,
  hook_style     TEXT,
  template       TEXT NOT NULL DEFAULT 'kinetic',
  shot_sheet     TEXT NOT NULL,
  caption        TEXT,
  hashtags       TEXT,
  status         TEXT NOT NULL DEFAULT 'planned',
  prompt_version TEXT,
  guidance       TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(script_id, day_index)
);
CREATE INDEX IF NOT EXISTS idx_reels_week ON reels(week_start, day_index);

CREATE TABLE IF NOT EXISTS render_jobs (
  id           TEXT PRIMARY KEY,
  reel_id      TEXT NOT NULL REFERENCES reels(id),
  status       TEXT NOT NULL DEFAULT 'queued',
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  runner       TEXT,
  last_error   TEXT,
  claimed_at   TEXT,
  started_at   TEXT,
  finished_at  TEXT,
  mp4_bytes    INTEGER,
  mp4_sha256   TEXT,
  duration_sec REAL,
  width        INTEGER,
  height       INTEGER,
  fps          INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON render_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS media_assets (
  id          TEXT PRIMARY KEY,
  reel_id     TEXT NOT NULL REFERENCES reels(id),
  kind        TEXT NOT NULL,
  storage     TEXT NOT NULL,
  storage_key TEXT,
  url         TEXT,
  bytes       INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_media_reel ON media_assets(reel_id, kind);

CREATE TABLE IF NOT EXISTS publications (
  id              TEXT PRIMARY KEY,
  reel_id         TEXT NOT NULL UNIQUE REFERENCES reels(id),
  status          TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_for   TEXT NOT NULL,
  auto_approved   INTEGER NOT NULL DEFAULT 0,
  caption         TEXT,
  ig_container_id TEXT,
  ig_media_id     TEXT,
  permalink       TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  published_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id              TEXT PRIMARY KEY,
  reel_id         TEXT NOT NULL REFERENCES reels(id),
  captured_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  age_hours       REAL,
  views           INTEGER,
  reach           INTEGER,
  impressions     INTEGER,
  likes           INTEGER,
  comments        INTEGER,
  shares          INTEGER,
  saves           INTEGER,
  engagement_rate REAL,
  raw             TEXT
);
CREATE INDEX IF NOT EXISTS idx_metrics_reel ON metric_snapshots(reel_id, captured_at);

CREATE TABLE IF NOT EXISTS insights (
  id               TEXT PRIMARY KEY,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  summary          TEXT NOT NULL,
  recommendations  TEXT NOT NULL,
  based_on_reels   INTEGER NOT NULL DEFAULT 0,
  based_on_metrics INTEGER NOT NULL DEFAULT 0,
  model            TEXT NOT NULL,
  raw              TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  level   TEXT NOT NULL,
  source  TEXT NOT NULL,
  message TEXT NOT NULL,
  data    TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);

CREATE TABLE IF NOT EXISTS login_throttle (
  key          TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  window_start TEXT
);

CREATE TABLE IF NOT EXISTS reminders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  sent_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  provider   TEXT,
  status     TEXT,
  detail     TEXT
);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('posting_time',         '18:00'),
  ('timezone',             'Asia/Kolkata'),
  ('auto_approve_publish', 'true'),
  ('reminder_time',        '08:00'),
  ('reminder_email',       'abhradeep2024@gmail.com'),
  ('retention_days',       '30'),
  ('gemini_model',         'gemini-2.5-flash'),
  ('prompt_version',       'v1'),
  ('caption_suffix',       ''),
  ('default_hashtags',     '["#reels", "#instagood"]');
