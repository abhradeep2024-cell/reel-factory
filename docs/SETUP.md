# Reel Factory - Setup Guide

This guide lists every credential and manual step needed to go from "all mock modes" to a fully live, zero-cost factory. Each section is independent - connect them in any order. The dashboard always shows the true state of each integration.

## What runs without any credentials

| Capability | Mode without credentials |
|---|---|
| Dashboard, script intake, D1 storage | fully live |
| Weekly planning (script -> 7 shot sheets) | deterministic **mock planner** (clearly labeled) |
| Video rendering (HTML -> MP4) | fully live once the GitHub runner is connected |
| Publishing | **dry-run** (nothing is posted, events logged) |
| Metrics | none recorded (honestly reported as empty) |
| Email reminders | log-only |

## 1. Cloudflare (Worker + D1 + optional R2)

You need: a free Cloudflare account, an API token, your Account ID.

```bash
npm install
npx wrangler login            # OR use a token: export CLOUDFLARE_API_TOKEN=...
npx wrangler d1 create reel-factory-db
# copy the printed database_id into wrangler.jsonc (and wrangler.r2.jsonc)
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put ADMIN_PASSWORD        # dashboard password
npx wrangler secret put SESSION_SECRET        # openssl rand -hex 32
npx wrangler secret put INTERNAL_API_KEY      # openssl rand -hex 32 (shared with GitHub)
npx wrangler secret put REMINDER_EMAIL        # where reminders go
npx wrangler deploy
```

After deploying, note your URL (`https://reel-factory.<your-subdomain>.workers.dev`) and set it as the `app_origin` setting in the dashboard (Settings) so media URLs are absolute for Instagram.

Free tier facts (verified Oct 2026): Workers 100k req/day (static assets free/unlimited), D1 5M reads + 100k writes/day, 3 cron triggers used (limit 5/account).

### R2 (recommended for live publishing)

R2 stores rendered MP4s and serves them at `/media/<key>` - Instagram requires a publicly fetchable video URL.

1. In the Cloudflare dashboard, enable R2 (free tier: 10 GB storage, zero egress).
2. Create the bucket: `npx wrangler r2 bucket create reel-factory-media`
3. Deploy the R2 variant: `npm run deploy:r2` (uses `wrangler.r2.jsonc`)

Without R2 the system still renders and tracks videos, but they remain runner artifacts (dashboard shows "not stored").

## 2. GitHub (repo + render runner)

1. Create a repository (public = free unlimited Actions minutes; private = 2,000 min/month, which still covers ~7 renders/week).
2. Push this code to `main`.
3. Repository secrets (Settings -> Secrets and variables -> Actions):

| Secret | Value |
|---|---|
| `APP_URL` | `https://reel-factory.<subdomain>.workers.dev` |
| `INTERNAL_API_KEY` | same value as the Cloudflare secret |
| `CLOUDFLARE_API_TOKEN` | token with Workers Scripts:Edit + D1:Edit (for the deploy workflow) |
| `CLOUDFLARE_ACCOUNT_ID` | your account ID |

4. The `render` workflow runs every 15 minutes (schedule) - you can also trigger it manually (Actions -> render -> Run workflow).

Rendering cost estimate: ~8-12 minutes per 60s reel on the standard runner.

## 3. Gemini (AI planning + insights)

1. Create a key at https://aistudio.google.com/apikey (free tier).
2. `npx wrangler secret put GEMINI_API_KEY`
3. Optionally set the model in dashboard Settings (default `gemini-2.5-flash`).

Without the key, the deterministic mock planner is used and labeled as such. When the key is set but a Gemini call fails after retries, planning fails loudly (event log) - it never silently falls back to mock.

Free tier is per-model (RPM/RPD); this app makes ~2-10 calls/week.

## 4. Instagram publishing (requires Meta app setup)

Prerequisites: an Instagram **professional** (business/creator) account connected to a Facebook Page.

1. Create an app at https://developers.facebook.com -> type "Business" -> add the "Instagram" product.
2. For personal use you can stay in Development mode and add yourself as a tester; for production use, submit for App Review with the `instagram_business_content_publish` (Instagram Login) or `instagram_content_publish` (Facebook Login) permission.
3. Get a long-lived token for your IG user and note your IG User ID.
4. Set secrets:

```bash
npx wrangler secret put IG_USER_ID
npx wrangler secret put IG_ACCESS_TOKEN
```

Publishing flow used: create REELS container (public `video_url`) -> poll `status_code` until `FINISHED` -> `media_publish` -> store media ID. Rate limit: 100 API posts / 24h (we use 7). The app enforces duplicate prevention via an atomic status claim.

Known Meta issues (observed in the wild, retried automatically): transient `2207076` video download failures; some accounts require a **system-user token** (Meta Business Suite -> System users -> assign the Page with "Content" task) when user tokens fail with OAuth code 1 on `media_publish`. If you hit this, switch the token type - the API surface is identical.

Token rotation: long-lived tokens expire (~60 days). Set a calendar reminder and update `IG_ACCESS_TOKEN` (`wrangler secret put` redeploys).

## 5. Email reminders

Resend (recommended free tier: 3,000/month, 100/day):

1. Sign up at https://resend.com with the same email that should receive reminders.
2. Create an API key, then:

```bash
npx wrangler secret put EMAIL_PROVIDER     # value: resend
npx wrangler secret put RESEND_API_KEY
```

Without a verified domain Resend only delivers to your own account email from `onboarding@resend.dev` - which is exactly the reminder use-case. Brevo (300/day) is also supported (`EMAIL_PROVIDER=brevo` + `BREVO_API_KEY`).

Reminders fire daily at 08:00 Asia/Kolkata (cron `30 2 * * *` UTC) while the upcoming week's script is missing, max one email per day, and stop as soon as the script is submitted.

## 6. Everything else (already configured)

- Cron triggers ship with the deploy: daily reminder check, hourly production tick (publish due reels, sync metrics, recover stuck jobs), Monday planner safety net.
- The learning loop runs on whatever real metrics exist; with fewer than 3 measured reels it reports "not enough data" instead of guessing.

## Security checklist

- [ ] Rotate the GitHub PAT and Cloudflare token you used during initial setup
- [ ] `ADMIN_PASSWORD` is strong (it gates the whole dashboard)
- [ ] All secrets live in `wrangler secret` / GitHub secrets - never in code
- [ ] `.dev.vars` is gitignored (only `.dev.vars.example` is committed)

## Troubleshooting

| Symptom | Fix |
|---|---|
| Renders stay queued > 15 min | Check Actions tab -> render workflow run; verify `APP_URL` + `INTERNAL_API_KEY` secrets match the worker |
| `planning_failed` events | With Gemini: check the event detail and API key; you can force-replan from the Script view |
| Publish fails with container ERROR | Usually the video URL is not publicly fetchable: set `app_origin`, ensure R2 deploy (`npm run deploy:r2`), retry from the board |
| Reminder emails missing | `EMAIL_PROVIDER` + `RESEND_API_KEY` set? Check Activity feed - every attempt is logged |
