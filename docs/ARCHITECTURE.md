# Architecture

## Components

```
                    +----------------------------- Cloudflare (free) -----------------------------+
                    |  Worker "reel-factory" (Hono, TypeScript)                                    |
                    |   - serves the static dashboard (Workers Static Assets)                      |
                    |   - REST API under /api/* (session cookie auth)                              |
                    |   - internal API under /internal/* (X-Internal-Key, used by the runner)      |
                    |   - public media streaming /media/* from R2 (range requests supported)       |
                    |   - D1 database (scripts, reels, jobs, media, publications, metrics,         |
                    |     insights, events, reminders, settings)                                   |
                    |   - Cron Triggers (UTC):                                                     |
                    |       30 2 * * *   08:00 IST daily   -> reminder check                       |
                    |       0 * * * *    hourly            -> publish due + metrics + job recovery |
                    |       35 2 * * 1   Mon 08:05 IST     -> weekly planner safety net            |
                    +---------------+-----------------------------------+-------------------------+
                                    |                                   |
                     internal API   |                                   | Gemini API (when key set)
                                    v                                   v
      GitHub Actions "render" workflow                        planner + insights prompts
      - every 15 min / manual / repository_dispatch             (structured JSON output,
      - claims one job at a time (atomic)                        schema-validated, one repair
      - shot sheet -> deterministic HTML film                   pass, honest failure otherwise)
      - Playwright: seek every frame at 30fps, screenshot JPEG
      - FFmpeg: H.264 high/yuv420p, closed GOP, faststart,
        VBR <= 20Mbps, 1080x1920 (Instagram spec)
      - ffprobe validation (codec, size, fps, duration)
      - upload MP4 + thumbnail to the Worker -> R2
      - report result; retries up to 3 attempts
                                    |
                                    v
                     Instagram Graph API (after credentials)
                     container -> poll -> publish -> store media IDs
                     insights metrics -> D1 snapshots -> learning loop
```

## Weekly lifecycle

1. **Sunday**: reminder cron nags at 08:00 IST until a script exists for the upcoming week.
2. **Submission**: `POST /api/scripts` stores the script; planning runs in the background (mock or Gemini). The script-to-week mapping: a script covers the next Mon-Sun week (a Monday submission before the posting slot covers the same week).
3. **Planning**: 7 reel plans, each a schema-validated shot sheet (5-14 scenes, durations 2-12s summing to 56-64s, target 60s). Latest insights become creative guidance for the next planning pass.
4. **Rendering**: jobs queue in D1; the Actions runner claims + renders + uploads; auto-scheduling follows a successful render (if auto-approve is on).
5. **Publishing**: hourly tick publishes due reels (atomic claim prevents duplicates); dry-run until Instagram is configured.
6. **Measuring**: hourly metrics sync stores snapshots; insights generation turns them into recommendations; those feed step 3 of the next week. With fewer than 3 measured reels the loop honestly reports insufficient data.

## Deterministic rendering (no video model)

- Every film is a single self-contained HTML file with **zero CSS animations/transitions**. A tiny runtime exposes `window.__film.seek(t)`; every visual property is a pure function of `t` (ms).
- The renderer loads the file in headless Chromium, calls `seek(t)` for each of the 1800 frames (60s x 30fps) and screenshots to JPEG.
- Four template families (kinetic typography, anime/speed-lines, glass motion, chat story) parameterized by scene camera moves, moods (closed color scripts), emphasis flags and keyword-driven SVG motifs.
- Fonts are embedded as base64 so the sandbox and the GitHub runner produce identical frames.
- Encoding follows the Instagram Reels spec exactly (see the runner box above); every output is ffprobe-validated before being marked rendered.

## Data model (D1)

`scripts` (one per week) -> `reels` (7 per script, unique day_index) -> `render_jobs` (attempts, meta) / `media_assets` (R2 keys) / `publications` (one per reel, atomic status machine) -> `metric_snapshots` (time series) -> `insights` (recommendations JSON, model label). `events` is the audit log the dashboard Activity feed shows; `settings` holds non-secret configuration; `reminders` records every nag email.

## Security

- Dashboard auth: single admin password -> HMAC-signed HttpOnly session cookie, constant-time compares, login rate limiting (5 fails / 15 min).
- Runner API: shared `INTERNAL_API_KEY` secret, constant-time compare.
- Secrets only via `wrangler secret` / GitHub secrets. No credentials in code, ever.
- Instagram never receives a test post: publishing is dry-run until IG secrets exist, and the first live publish happens only when you configure it.
