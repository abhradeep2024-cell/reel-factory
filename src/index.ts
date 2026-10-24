// Reel Factory worker entrypoint.
// Architecture: Cloudflare Worker (Hono) + D1 + R2(optional) + static dashboard.
// Rendering runs on GitHub Actions (Chromium + FFmpeg), never on the Worker.
// Cron Triggers (UTC): 30 2 * * * (08:00 IST reminder), 0 * * * * (hourly
// production tick), 35 2 * * 1 (Mon 08:05 IST weekly planner).
import { Hono } from 'hono';
import type { Env } from './lib/env';
import { requireAuth } from './lib/auth';
import { authRoutes } from './routes/auth';
import { apiRoutes } from './routes/api';
import { internalRoutes } from './routes/internal';
import { mediaRoutes } from './routes/media';
import { runReminderCron, runHourlyCron, runWeeklyCron } from './services/cron';

const app = new Hono<{ Bindings: Env }>();

// public routes first (registered before the /api guard)
app.route('/api/auth', authRoutes);
app.route('/media', mediaRoutes);

// auth guard for the rest of /api/*
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/health' || path.startsWith('/api/auth/') || path.startsWith('/api/media/')) {
    return next();
  }
  return requireAuth(c, next);
});
app.route('/api', apiRoutes);

// internal runner API (own key auth)
app.route('/internal', internalRoutes);

app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/') || path.startsWith('/internal/') || path.startsWith('/media/')) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      try {
        if (event.cron === '30 2 * * *') await runReminderCron(env);
        else if (event.cron === '0 * * * *') await runHourlyCron(env);
        else if (event.cron === '35 2 * * 1') await runWeeklyCron(env);
        else console.log('unmatched cron', event.cron);
      } catch (e) {
        console.error('cron failed', event.cron, e);
      }
    })());
  },
} satisfies ExportedHandler<Env>;
