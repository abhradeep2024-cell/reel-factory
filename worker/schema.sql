-- Auto-Reel Factory — D1 schema
CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL UNIQUE,          -- YYYY-MM-DD (Sunday)
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',  -- received | scenes_generated | failed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  day_index INTEGER NOT NULL,               -- 0..6 (Mon..Sun posting order)
  scheduled_date TEXT NOT NULL,             -- YYYY-MM-DD when this reel should post
  video_path TEXT,                          -- /reels/2026-W44-day1.mp4 (served as static asset)
  duration_s REAL,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'queued',    -- queued | rendering | rendered | posted | failed
  posted_at TEXT,
  ig_media_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(week_start, day_index)
);

CREATE TABLE IF NOT EXISTS scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reel_id INTEGER NOT NULL REFERENCES reels(id),
  idx INTEGER NOT NULL,                     -- scene order
  kind TEXT NOT NULL,                       -- hook | point | list | quote | cta
  headline TEXT NOT NULL,
  body TEXT,
  keywords TEXT,                            -- JSON array
  duration_s REAL NOT NULL DEFAULT 10,
  direction TEXT                            -- free-form AI notes for the renderer
);

CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ig_media_id TEXT NOT NULL UNIQUE,
  reel_id INTEGER,
  plays INTEGER, reach INTEGER, likes INTEGER, comments INTEGER, saves INTEGER,
  avg_watch_pct REAL,
  retention_json TEXT,                      -- per-second retention if available
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT,
  summary TEXT NOT NULL,                    -- plain-English "what worked"
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                       -- reminder | post | render | learn | error
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
