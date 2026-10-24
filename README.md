# Reel Factory

Automated Instagram Reel factory: **one weekly script in - seven animated Reels out**, rendered to real 1080x1920 MP4 videos, scheduled, published and measured - on entirely free-tier infrastructure.

```
weekly script -> Gemini (or deterministic mock) -> 7 shot sheets
            -> deterministic HTML/CSS animations (no video model)
            -> Chromium frame capture + FFmpeg H.264 (GitHub Actions)
            -> R2 storage -> scheduled Instagram publishing -> analytics
            -> learning loop feeds next week's planning
```

## Highlights

- **No AI video generation.** Scenes are animated motion-graphics/anime-style HTML (concept adapted from [html-anime](https://github.com/blixvip/html-anime), MIT) rendered deterministically by seeking every frame - same input, same output, on any machine.
- **Zero-cost architecture.** Cloudflare Workers + D1 (free tier), GitHub Actions render runner (free on public repos), Gemini API free tier, Resend free tier for reminders.
- **Honest by design.** The dashboard shows real integration states only - `mock` planner, `dry_run` publisher and `log` email modes are clearly labeled until you connect the real services. Nothing is posted to Instagram until you configure and authorize it.
- **Self-learning loop.** Real Instagram Insights metrics are recorded per reel and turned into planning guidance (with "correlation is not causation" guardrails).

## Repository layout

```
src/            Cloudflare Worker (Hono + TypeScript): API, cron, publisher, learning loop
  shared/       Framework-free .mjs modules shared by worker + renderer + tests
  routes/       HTTP routes (dashboard API + internal runner API)
  services/     Planner, render queue, publishing, metrics, insights, reminders, cron
public/         Mobile-first dashboard (vanilla JS, no frameworks)
render/         Deterministic HTML film engine + capture + encode pipeline (Node)
migrations/     D1 SQL migrations
tests/          Unit tests (node:test) + end-to-end suite
docs/           SETUP.md (credentials guide), ARCHITECTURE.md, VERIFICATION.md
.github/        render runner + deploy workflows
```

## Quick start (local)

```bash
npm install
cp .dev.vars.example .dev.vars   # then set ADMIN_PASSWORD + generated secrets
npm run db:local                # apply D1 migrations (local sqlite)
npm run dev                     # dashboard at http://localhost:3000
npm test                        # unit tests
npm run e2e                     # full API workflow test (boots isolated worker)
npm run render:sample           # render a real 60s sample reel to out/sample
```

## Deployment

See **[docs/SETUP.md](docs/SETUP.md)** for the complete, honest setup guide: every secret, every manual approval, and what stays in mock mode until each credential is added.

## Credits

- Shot-sheet scene model adapted from [html-anime](https://github.com/blixvip/html-anime) by blixvip (MIT).
- The seek-per-frame deterministic rendering architecture follows the same proven approach as [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0); this project implements its own self-contained renderer on Playwright + FFmpeg.
- Carlito fonts by Lukasz Dziedzic, embedded under the SIL Open Font License (see `render/engine/fonts/`).

## License

MIT
