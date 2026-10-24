// Internal API (X-Internal-Key): render-runner job protocol + cron triggers
// + dev-only metric seeding for tests. Used by GitHub Actions and the e2e suite.
import { Hono } from 'hono';
import type { Env } from '../lib/env';
import { requireInternalKey } from '../lib/auth';
import { claimJob, receiveResult, uploadMedia } from '../services/renderqueue';
import { runReminderCron, runHourlyCron, runWeeklyCron } from '../services/cron';
import { instagramConfigured } from '../services/instagram';
import { logEvent } from '../lib/events';
import { all, run } from '../lib/db';
import { shortId } from '../lib/crypto';

export const internalRoutes = new Hono<{ Bindings: Env }>();
internalRoutes.use('*', requireInternalKey);

internalRoutes.post('/render/claim', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const job = await claimJob(c.env, String(body?.runner || 'github-actions'));
  return c.json({ job: job || null });
});

internalRoutes.put('/render/upload', async (c) => {
  const jobId = c.req.query('job_id');
  const kind = c.req.query('kind') === 'thumbnail' ? 'thumbnail' : 'mp4';
  if (!jobId) return c.json({ error: 'job_id query param required' }, 400);
  try {
    const r = await uploadMedia(c.env, jobId, kind as 'mp4' | 'thumbnail', c.req.raw);
    return c.json(r);
  } catch (e: any) {
    return c.json({ error: e?.message || e }, 400);
  }
});

internalRoutes.post('/render/result', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(await receiveResult(c.env, body));
  } catch (e: any) {
    return c.json({ error: e?.message || e }, 400);
  }
});

internalRoutes.post('/cron/:name', async (c) => {
  const name = c.req.param('name');
  if (name === 'reminder') return c.json(await runReminderCron(c.env));
  if (name === 'hourly') return c.json(await runHourlyCron(c.env));
  if (name === 'weekly') return c.json(await runWeeklyCron(c.env));
  return c.json({ error: 'unknown cron name' }, 404);
});

// Synthetic metrics: strictly for tests and local demos, only allowed while
// Instagram is NOT configured. Every seeded row is marked in its raw payload.
internalRoutes.post('/dev/seed-metrics', async (c) => {
  if (instagramConfigured(c.env)) {
    return c.json({ error: 'refusing: Instagram is configured - use real metrics only' }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const week = body?.week ? String(body.week) : null;
  const reels = await all<any>(c.env,
    `SELECT r.id, r.template, r.hook_style, p.published_at FROM reels r
     JOIN publications p ON p.reel_id = r.id
     WHERE r.status IN ('published','dry_run') ${week ? 'AND r.week_start = ?' : ''}`,
    ...(week ? [week] : []));
  let n = 0;
  for (const reel of reels) {
    const bias = reel.hook_style === 'question' ? 1.9 : reel.template === 'anime' ? 1.4 : 1.0;
    const views = Math.round((400 + Math.random() * 5200) * bias);
    const likes = Math.round(views * (0.04 + Math.random() * 0.08) * bias);
    const comments = Math.round(likes * (0.05 + Math.random() * 0.1));
    const shares = Math.round(likes * 0.08);
    const saves = Math.round(likes * 0.15);
    const ageHours = 24 + Math.random() * 96;
    const er = Math.round(((likes + comments + shares + saves) / Math.max(views, 1)) * 10000) / 10000;
    await run(c.env,
      `INSERT INTO metric_snapshots(id, reel_id, age_hours, views, reach, impressions, likes, comments, shares, saves, engagement_rate, raw)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      shortId('ms'), reel.id, Math.round(ageHours * 10) / 10,
      views, Math.round(views * 0.72), Math.round(views * 0.9), likes, comments, shares, saves, er,
      JSON.stringify({ source: 'synthetic-seed', note: 'NOT REAL DATA - seeded for testing' }));
    n++;
  }
  await logEvent(c.env, 'warn', 'metrics', `Seeded ${n} SYNTHETIC metric snapshots (testing only)`);
  return c.json({ seeded: n });
});
