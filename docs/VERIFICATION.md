# Verification Record

Everything below was executed and observed during the build session (2026-10-24). Every claim maps to a command you can re-run yourself.

## Automated tests

| Suite | Result | Re-run with |
|---|---|---|
| Unit tests - 24 tests: shot-sheet schema validation, mock planner determinism + 7-distinct-hooks + exact 60s durations, IST/DST-safe week math (incl. America/New_York fall-back), engagement heuristics + honesty guardrails, prompt builders | **24/24 pass** | `npm test` |
| End-to-end suite - 35 assertions against a real `wrangler dev` instance with an isolated D1 database | **35/35 pass** | `npm run e2e` |

E2E coverage: unauthenticated 401s, wrong-password 401, valid login + cookie, honest integration modes (mock/dry_run), script intake, auto-planning (7 reels, ~60s, 7 distinct hook styles), render queue protocol (enqueue, duplicate rejection 409, internal-key auth 401, atomic claim, upload, result intake), auto-scheduling after render, dry-run publishing exactly once with duplicate prevention, synthetic-metric seeding (marked synthetic), real metrics sync correctly skipping (Instagram not configured), insights honesty (insufficient-data guardrail), audit events for planner/render/publisher, all three cron handlers.

## Render pipeline (real MP4s, ffprobe-validated)

| Render | Result |
|---|---|
| 8s pipeline smoke (kinetic) | PASSED (10.8s, 30fps, 3.3MB, yuv420p tv-range) |
| Full 60s sample (day 1, kinetic) | h264, 1080x1920, yuv420p, tv-range, 30/1 fps, 60.000s, 13.7MB - `download/sample-reel-day1.mp4` |
| **Production render on the live worker** | job enqueued via API -> claimed -> rendered -> validated (60s, 30fps, 13.4MB) -> result reported -> reel auto-scheduled for Mon 2026-10-26 18:00 IST (12:30 UTC). Audit trail in the live events feed. |

## Live deployment (verified 2026-10-24)

- URL: **https://reel-factory.abhradeep2024-cell.workers.dev**
- `/api/health`: `{"ok":true,...,"bindings":{"d1":"ok"}}`
- D1 `reel-factory-db` created; migration `0001_init.sql` applied remotely
- 3 cron triggers registered and confirmed via API: `30 2 * * *`, `0 * * * *`, `35 2 * * 1`
- Worker secrets set: ADMIN_PASSWORD, SESSION_SECRET, INTERNAL_API_KEY, REMINDER_EMAIL
- Live flow verified: login, settings update (app_origin), demo script submission, auto-planning (7 reels, mock planner), production render (above), auto-schedule

## Dashboard browser verification (mobile 390x844 + desktop 1280x800, Playwright)

Login screen renders -> login succeeds -> overview renders with honest integration badges -> board shows 7 day cards -> videos view -> insights with live activity events -> settings values load (posting_time 18:00) -> script form -> zero console/page errors. Screenshots: `download/dashboard-shots/`.

A real frontend bug (`modeBadge` missing import in app.js) was caught by this verification and fixed + redeployed before delivery - exactly why browser-level verification is part of the definition of done.

## Honest limitations (current state, by design)

| Capability | State | What activates it |
|---|---|---|
| AI planning | deterministic **mock planner** (labeled in UI) | set `GEMINI_API_KEY` secret |
| Instagram publishing | **dry-run** - nothing is ever posted | IG professional account + `IG_USER_ID` + `IG_ACCESS_TOKEN` secrets |
| Email reminders | **log-only** | `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` secrets |
| Video storage / public URLs | runner artifacts only | enable R2 in the Cloudflare dashboard, then `npm run deploy:r2` |
| Scheduled CI render runner | workflows not yet on GitHub | PAT needs *Workflows: read and write*; reference copies in `docs/workflows-*.yml` |
| Insights | "not enough data" guardrail | real metrics require live publishing first |
