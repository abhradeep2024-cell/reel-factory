-- Reel Factory — D1 schema
CREATE TABLE IF NOT EXISTS weeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL UNIQUE,          -- ISO date of the Sunday this week starts
  script TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'script_received',
  lessons_used TEXT,                         -- snapshot of lessons fed to Gemini
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,                        -- hook | point | quote | cta
  duration REAL NOT NULL DEFAULT 10,
  headline TEXT NOT NULL,
  lines TEXT,                                -- JSON array
  caption TEXT,
  narration TEXT,
  accent TEXT,
  UNIQUE(week_id, idx)
);

CREATE TABLE IF NOT EXISTS reels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  post_day INTEGER NOT NULL,                 -- 0..6 -> Sunday..Saturday
  caption TEXT NOT NULL DEFAULT '',
  video_url TEXT,
  render_status TEXT NOT NULL DEFAULT 'pending',
  ig_media_id TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(week_id, post_day)
);

CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reel_id INTEGER NOT NULL REFERENCES reels(id),
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  plays INTEGER, likes INTEGER, comments INTEGER, saves INTEGER,
  reach INTEGER, avg_watch_pct REAL
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id INTEGER REFERENCES weeks(id),
  body TEXT NOT NULL,
  metrics_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL DEFAULT 'script_reminder',
  channel TEXT NOT NULL DEFAULT 'email'
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
