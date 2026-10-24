# 🎬 Reel Factory

One Sunday script → six 10-second scenes → one 60-second Instagram reel, rendered **100% free** (HTML animation, no AI video APIs) and posted daily at your best time.

## How it works

```
You (Sunday)            Cloudflare Worker              GitHub Actions           Instagram
     │  paste script  →   D1 stores week + slots   ─┐
     │                                            │ repository_dispatch
     │  "Split into scenes" → Gemini (free) ──────┤
     │                                            └→  Puppeteer renders HTML
     │                                                animation frame-by-frame
     │                                                → FFmpeg → 60s mp4
     │                                                → POST back to Worker
     │                                                → R2 storage (public URL)
     │                                            ┌─ cron 18:30 IST: post via Graph API
     └─ 08:00 IST email reminder (only if script missing)
                                                  └─ cron 22:00 IST: pull insights → lessons → next week's scenes get smarter
```

## Components

| Folder | What it is | Where it runs |
|---|---|---|
| `worker/` | Dashboard + API + cron brains (script intake, Gemini split, render dispatch, IG posting, reminders, learning loop) | Cloudflare Workers |
| `db/schema.sql` | D1 schema (weeks, scenes, reels, insights, lessons, reminders) | Cloudflare D1 |
| `renderer/` | HTML animation template + deterministic frame-stepping renderer | GitHub Actions (free minutes) |
| `.github/workflows/render.yml` | Render pipeline (auto + manual trigger) | GitHub Actions |

## Setup (one-time)

```bash
cd worker
npm install
npx wrangler d1 create reel-factory-db          # paste database_id into wrangler.toml
npx wrangler r2 bucket create reel-factory-reels
npx wrangler d1 execute reel-factory-db --remote --file=../db/schema.sql
npx wrangler deploy                              # then set the secrets below
```

### Secrets (`npx wrangler secret put NAME`)

| Secret | Purpose |
|---|---|
| `GH_RENDER_TOKEN` | GitHub PAT (fine-grained, Contents: read/write on this repo) to trigger render jobs |
| `RENDER_SECRET` | Random string, shared with GitHub repo secret of the same name (authenticates render uploads) |
| `GEMINI_API_KEY` | aistudio.google.com — free tier (script → scenes + lesson distillation) |
| `IG_USER_ID` + `IG_ACCESS_TOKEN` | Instagram Business account + Meta app (posting + insights). **Pending from owner** |
| `RESEND_API_KEY` | resend.com — free 100 emails/day (8 AM reminders). Reminder works in dry-run without it |

Also add the same `RENDER_SECRET` as a **GitHub repo secret**, and `WORKER_URL` in `wrangler.toml` after first deploy.

### GitHub repo settings

Enable **Actions** → workflow `render-reel` (runs on `repository_dispatch` + manual trigger).

## Feature flags (automatic)

Every integration activates when its secret exists — until then the system runs in dry-run:
- No `GEMINI_API_KEY` → split button explains what's missing
- No IG creds → posting + insights logged as dry-run, reels accumulate in dashboard
- No `RESEND_API_KEY` → reminders recorded in DB and shown on dashboard, no email

## Cron schedule (UTC / IST)

| Cron | IST | Job |
|---|---|---|
| `30 2 * * *` | 08:00 | Email reminder if this week's script is missing |
| `0 13 * * *` | 18:30 | Post today's rendered reel (default best time) |
| `30 16 * * *` | 22:00 | Pull insights → distill 3 lessons → feed next split |

## Roadmap

- Edge-TTS narration muxed into renders (`narration` field already flows through scenes)
- Best-time detection replaces fixed 18:30 slot from real insights
- Per-scene retention (drop-off heatmap) via longer-form IG insights
