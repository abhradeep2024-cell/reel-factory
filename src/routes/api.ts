// Main authenticated API: status, scripts, reels, jobs, publishing,
// metrics, insights, settings, events.
import { Hono } from 'hono';
import type { Env } from '../lib/env';
import { all, one, run, nowIso, jsonParse } from '../lib/db';
import { logEvent, listEvents } from '../lib/events';
import { getSettings, validateSettings, saveSettings } from '../lib/settings';
import { shortId } from '../lib/crypto';
import { weekStartForScript, fmtLocal } from '../shared/weektime.mjs';
import { validateReelPlan, normalizeReelPlan } from '../shared/shotsheet.mjs';
import { planWeek } from '../services/planner';
import { enqueueRender } from '../services/renderqueue';
import { schedulePublication, cancelPublication, attemptPublish, publishDue } from '../services/publish';
import { syncMetrics } from '../services/metrics';
import { generateInsights } from '../services/learn';
import { geminiConfigured } from '../services/gemini';
import { instagramConfigured } from '../services/instagram';
import { sendMail } from '../services/mail';

export const apiRoutes = new Hono<{ Bindings: Env }>();

// ---------------- health (public; mounted behind the auth skip-list) ----------------
apiRoutes.get('/health', async (c) => {
  let d1 = 'ok';
  try {
    await c.env.DB.prepare('SELECT 1 AS x').first();
  } catch {
    d1 = 'error';
  }
  return c.json({
    ok: d1 === 'ok',
    app: 'reel-factory',
    version: '1.0.0',
    time: nowIso(),
    bindings: { d1, r2: c.env.MEDIA ? 'yes' : 'no' },
  });
});

// ---------------- status ----------------
apiRoutes.get('/status', async (c) => {
  const settings = await getSettings(c.env);
  const now = Date.now();
  const target = weekStartForScript(now, settings.timezone, settings.posting_time);
  const script = await one<any>(c.env,
    'SELECT id, week_start, status, submitted_at, title FROM scripts WHERE week_start = ?', target.dateStr);
  const reels = await all<any>(c.env,
    'SELECT status, COUNT(*) AS n FROM reels WHERE week_start = ? GROUP BY status', target.dateStr);
  const pendingJobs = await one<any>(c.env,
    `SELECT COUNT(*) AS n FROM render_jobs WHERE status IN ('queued','claimed','running')`);
  const lastJob = await one<any>(c.env,
    'SELECT id, status, finished_at, last_error, duration_sec FROM render_jobs ORDER BY created_at DESC LIMIT 1');
  const nextPub = await one<any>(c.env, `
    SELECT p.scheduled_for, p.status, r.title
    FROM publications p JOIN reels r ON r.id = p.reel_id
    WHERE p.status = 'scheduled' ORDER BY p.scheduled_for LIMIT 1`);
  const emailProvider = (c.env.EMAIL_PROVIDER || 'log').toLowerCase();
  const emailLive =
    (emailProvider === 'resend' && !!c.env.RESEND_API_KEY) ||
    (emailProvider === 'brevo' && !!c.env.BREVO_API_KEY);
  return c.json({
    week: {
      target_week_start: target.dateStr,
      script: script || null,
      reels_by_status: Object.fromEntries(reels.map((r: any) => [r.status, r.n])),
    },
    integrations: {
      gemini: { configured: geminiConfigured(c.env), mode: geminiConfigured(c.env) ? 'live' : 'mock', model: settings.gemini_model },
      instagram: { configured: instagramConfigured(c.env), mode: instagramConfigured(c.env) ? 'live' : 'dry_run' },
      email: { provider: emailProvider, mode: emailLive ? 'live' : 'log' },
      r2_media: { enabled: !!c.env.MEDIA },
      render_runner: { type: 'github_actions', pending_jobs: pendingJobs?.n || 0, last_job: lastJob || null },
      app_origin: settings.app_origin || null,
    },
    next_publication: nextPub || null,
    time: { now_iso: nowIso(), timezone: settings.timezone, local: fmtLocal(now, settings.timezone) },
  });
});

// ---------------- scripts ----------------
apiRoutes.get('/scripts', async (c) => {
  const rows = await all<any>(c.env, `
    SELECT s.id, s.week_start, s.title, s.status, s.submitted_at,
           (SELECT COUNT(*) FROM reels r WHERE r.script_id = s.id) AS reel_count
    FROM scripts s ORDER BY s.week_start DESC LIMIT 30`);
  return c.json({ scripts: rows });
});

apiRoutes.post('/scripts', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const script = String(body?.script || '').trim();
  const title = String(body?.title || '').slice(0, 120).trim() || null;
  const autoPlan = body?.auto_plan !== false;
  if (script.length < 120) {
    return c.json({ error: 'script too short - paste the full weekly script (min 120 characters)' }, 400);
  }
  if (script.length > 20000) {
    return c.json({ error: 'script too long (max 20000 characters)' }, 400);
  }
  const settings = await getSettings(c.env);
  const target = weekStartForScript(Date.now(), settings.timezone, settings.posting_time);
  const existing = await one(c.env, 'SELECT id FROM scripts WHERE week_start = ?', target.dateStr);
  if (existing) {
    return c.json({ error: `a script for the week of ${target.dateStr} already exists (delete it first to replace)` }, 409);
  }
  const id = shortId('script');
  await run(c.env,
    `INSERT INTO scripts(id, week_start, title, content, status) VALUES (?,?,?,?,'submitted')`,
    id, target.dateStr, title, script);
  await logEvent(c.env, 'info', 'api',
    `Script submitted for week ${target.dateStr} (${script.length} chars)`, { script: id });
  if (autoPlan) {
    c.executionCtx.waitUntil(planWeek(c.env, id));
  }
  return c.json({ ok: true, id, week_start: target.dateStr, planning: autoPlan }, 201);
});

apiRoutes.get('/scripts/:id', async (c) => {
  const s = await one<any>(c.env, 'SELECT * FROM scripts WHERE id = ?', c.req.param('id'));
  if (!s) return c.json({ error: 'not found' }, 404);
  const reels = await all<any>(c.env,
    'SELECT id, day_index, title, status FROM reels WHERE script_id = ? ORDER BY day_index', s.id);
  return c.json({ script: { ...s, analysis: jsonParse(s.analysis, null) }, reels });
});

apiRoutes.delete('/scripts/:id', async (c) => {
  const script = await one<any>(c.env, 'SELECT * FROM scripts WHERE id = ?', c.req.param('id'));
  if (!script) return c.json({ error: 'not found' }, 404);
  const published = await one<any>(c.env,
    `SELECT COUNT(*) AS n FROM reels WHERE script_id = ? AND status IN ('published','dry_run')`, script.id);
  if (published?.n) {
    return c.json({ error: 'cannot delete: this week already has published or dry-run reels' }, 409);
  }
  await run(c.env, 'DELETE FROM render_jobs WHERE reel_id IN (SELECT id FROM reels WHERE script_id = ?)', script.id);
  await run(c.env, 'DELETE FROM publications WHERE reel_id IN (SELECT id FROM reels WHERE script_id = ?)', script.id);
  await run(c.env, 'DELETE FROM metric_snapshots WHERE reel_id IN (SELECT id FROM reels WHERE script_id = ?)', script.id);
  await run(c.env, 'DELETE FROM media_assets WHERE reel_id IN (SELECT id FROM reels WHERE script_id = ?)', script.id);
  await run(c.env, 'DELETE FROM reels WHERE script_id = ?', script.id);
  await run(c.env, 'DELETE FROM scripts WHERE id = ?', script.id);
  await logEvent(c.env, 'info', 'api', `Script deleted (week ${script.week_start})`);
  return c.json({ ok: true });
});

apiRoutes.post('/scripts/:id/plan', async (c) => {
  const s = await one<any>(c.env, 'SELECT * FROM scripts WHERE id = ?', c.req.param('id'));
  if (!s) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (s.status === 'planning') return c.json({ error: 'planning already in progress' }, 409);
  if (s.status === 'planned' && !body?.force) {
    return c.json({ error: 'already planned (pass {"force": true} to replan)' }, 409);
  }
  c.executionCtx.waitUntil(planWeek(c.env, s.id));
  return c.json({ ok: true, planning: true }, 202);
});

// ---------------- reels ----------------
apiRoutes.get('/reels', async (c) => {
  const week = c.req.query('week');
  const settings = await getSettings(c.env);
  const targetWeek = week || weekStartForScript(Date.now(), settings.timezone, settings.posting_time).dateStr;
  const rows = await all<any>(c.env, `
    SELECT r.*, p.status AS pub_status, p.scheduled_for, p.published_at, p.ig_media_id, p.permalink
    FROM reels r LEFT JOIN publications p ON p.reel_id = r.id
    WHERE r.week_start = ? ORDER BY r.day_index`, targetWeek);
  const out = [];
  for (const r of rows) {
    const media = await all<any>(c.env,
      'SELECT kind, url, bytes FROM media_assets WHERE reel_id = ? ORDER BY created_at DESC', r.id);
    const m = await one<any>(c.env,
      `SELECT views, reach, likes, comments, shares, saves, engagement_rate, age_hours, captured_at
       FROM metric_snapshots WHERE reel_id = ? ORDER BY captured_at DESC LIMIT 1`, r.id);
    const mp4 = media.find((x) => x.kind === 'mp4');
    const thumb = media.find((x) => x.kind === 'thumbnail');
    out.push({
      id: r.id,
      week_start: r.week_start,
      day_index: r.day_index,
      title: r.title,
      concept: r.concept,
      hook_style: r.hook_style,
      template: r.template,
      status: r.status,
      caption: r.caption,
      hashtags: jsonParse<string[]>(r.hashtags, []),
      duration_sec: jsonParse<any>(r.shot_sheet, {}).duration_sec ?? null,
      publish: {
        status: r.pub_status,
        scheduled_for: r.scheduled_for,
        published_at: r.published_at,
        ig_media_id: r.ig_media_id,
        permalink: r.permalink,
      },
      media: {
        mp4_url: mp4?.url || null,
        mp4_bytes: mp4?.bytes || null,
        thumb_url: thumb?.url || null,
      },
      metrics: m || null,
    });
  }
  return c.json({ week: targetWeek, reels: out });
});

apiRoutes.get('/reels/:id', async (c) => {
  const r = await one<any>(c.env, `
    SELECT r.*, p.status AS pub_status, p.scheduled_for, p.published_at, p.ig_media_id, p.permalink
    FROM reels r LEFT JOIN publications p ON p.reel_id = r.id WHERE r.id = ?`, c.req.param('id'));
  if (!r) return c.json({ error: 'not found' }, 404);
  const jobs = await all<any>(c.env,
    `SELECT id, status, attempts, max_attempts, last_error, started_at, finished_at, duration_sec, mp4_bytes
     FROM render_jobs WHERE reel_id = ? ORDER BY created_at DESC`, r.id);
  const media = await all<any>(c.env,
    'SELECT kind, storage, url, bytes, created_at FROM media_assets WHERE reel_id = ?', r.id);
  const metrics = await all<any>(c.env,
    'SELECT * FROM metric_snapshots WHERE reel_id = ? ORDER BY captured_at DESC LIMIT 20', r.id);
  return c.json({
    reel: { ...r, shot_sheet: jsonParse(r.shot_sheet, null), hashtags: jsonParse<string[]>(r.hashtags, []) },
    jobs, media, metrics,
  });
});

apiRoutes.put('/reels/:id', async (c) => {
  const reel = await one<any>(c.env, 'SELECT * FROM reels WHERE id = ?', c.req.param('id'));
  if (!reel) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (body?.shot_sheet) {
    const v = validateReelPlan(body.shot_sheet);
    if (!v.ok) return c.json({ error: 'invalid shot sheet', errors: v.errors }, 400);
    const norm = normalizeReelPlan(body.shot_sheet);
    await run(c.env, 'UPDATE reels SET shot_sheet = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(norm), nowIso(), reel.id);
  }
  const fields: string[] = [];
  const params: any[] = [];
  if (typeof body?.caption === 'string') { fields.push('caption = ?'); params.push(body.caption.slice(0, 2200)); }
  if (Array.isArray(body?.hashtags)) {
    fields.push('hashtags = ?');
    params.push(JSON.stringify(body.hashtags.filter((h: string) => /^#[^\s#]{1,28}$/.test(h)).slice(0, 8)));
  }
  if (typeof body?.template === 'string') { fields.push('template = ?'); params.push(body.template); }
  if (fields.length) {
    params.push(nowIso(), reel.id);
    await run(c.env, `UPDATE reels SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`, ...params);
  }
  await logEvent(c.env, 'info', 'api', 'Reel updated', { reel: reel.id });
  return c.json({ ok: true });
});

apiRoutes.post('/reels/:id/render', async (c) => {
  try {
    const job = await enqueueRender(c.env, c.req.param('id'));
    if (!job) return c.json({ error: 'reel not in a renderable state, or a job is already active' }, 409);
    return c.json({ ok: true, job_id: job });
  } catch (e: any) {
    return c.json({ error: e?.message || e }, 400);
  }
});

apiRoutes.post('/reels/render-all', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const settings = await getSettings(c.env);
  const targetWeek = body?.week || weekStartForScript(Date.now(), settings.timezone, settings.posting_time).dateStr;
  const reels = await all<any>(c.env, 'SELECT id FROM reels WHERE week_start = ?', targetWeek);
  const queued: string[] = [];
  for (const r of reels) {
    try {
      const j = await enqueueRender(c.env, r.id);
      if (j) queued.push(j);
    } catch { /* skip */ }
  }
  return c.json({ ok: true, week: targetWeek, queued: queued.length, jobs: queued });
});

// ---------------- publishing ----------------
apiRoutes.post('/reels/:id/publish', async (c) => {
  const reelId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const action = body?.action || 'schedule';
  try {
    if (action === 'cancel') {
      await cancelPublication(c.env, reelId);
      return c.json({ ok: true, action });
    }
    if (action === 'now') {
      const r = await attemptPublish(c.env, reelId);
      return c.json({ ok: r !== 'failed', result: r });
    }
    if (action === 'schedule') {
      const pub = await schedulePublication(c.env, reelId, body?.scheduled_at, body?.auto_approved === true);
      return c.json({ ok: true, publication: pub });
    }
    return c.json({ error: 'action must be schedule | now | cancel' }, 400);
  } catch (e: any) {
    return c.json({ error: e?.message || e }, 400);
  }
});

apiRoutes.post('/publish/due', async (c) => {
  const r = await publishDue(c.env);
  return c.json({ ok: true, ...r });
});

apiRoutes.get('/schedule', async (c) => {
  const rows = await all<any>(c.env, `
    SELECT p.id AS pub_id, p.status, p.scheduled_for, p.published_at, p.ig_media_id, p.permalink,
           p.attempts, p.last_error, p.auto_approved,
           r.id AS reel_id, r.title, r.day_index, r.week_start, r.status AS reel_status
    FROM publications p JOIN reels r ON r.id = p.reel_id
    ORDER BY p.scheduled_for DESC LIMIT 30`);
  return c.json({ schedule: rows });
});

// ---------------- jobs ----------------
apiRoutes.get('/jobs', async (c) => {
  const status = c.req.query('status');
  const rows = await all<any>(c.env, `
    SELECT j.*, r.title AS reel_title, r.day_index, r.week_start
    FROM render_jobs j JOIN reels r ON r.id = j.reel_id
    ${status ? 'WHERE j.status = ?' : ''} ORDER BY j.created_at DESC LIMIT 100`,
    ...(status ? [status] : []));
  return c.json({ jobs: rows });
});

apiRoutes.post('/jobs/:id/retry', async (c) => {
  const job = await one<any>(c.env, 'SELECT * FROM render_jobs WHERE id = ?', c.req.param('id'));
  if (!job) return c.json({ error: 'not found' }, 404);
  if (job.status !== 'failed') return c.json({ error: 'only failed jobs can be retried' }, 409);
  if (job.attempts >= job.max_attempts) {
    return c.json({ error: 'max attempts reached - trigger a fresh render from the reel instead' }, 409);
  }
  await run(c.env, `UPDATE render_jobs SET status='queued', last_error=NULL, updated_at=? WHERE id=?`, nowIso(), job.id);
  await run(c.env, `UPDATE reels SET status='queued', updated_at=? WHERE id=?`, nowIso(), job.reel_id);
  await logEvent(c.env, 'info', 'render', 'Job retried manually', { job: job.id });
  return c.json({ ok: true });
});

// ---------------- metrics & insights ----------------
apiRoutes.get('/metrics', async (c) => {
  const week = c.req.query('week');
  const rows = await all<any>(c.env, `
    SELECT ms.*, r.title, r.day_index, r.week_start
    FROM metric_snapshots ms JOIN reels r ON r.id = ms.reel_id
    ${week ? 'WHERE r.week_start = ?' : ''} ORDER BY ms.captured_at DESC LIMIT 500`,
    ...(week ? [week] : []));
  return c.json({ metrics: rows });
});

apiRoutes.post('/metrics/sync', async (c) => {
  const r = await syncMetrics(c.env);
  return c.json({ ok: true, ...r });
});

apiRoutes.get('/insights', async (c) => {
  const rows = await all<any>(c.env, 'SELECT * FROM insights ORDER BY created_at DESC LIMIT 10');
  return c.json({
    insights: rows.map((r) => ({
      ...r,
      recommendations: jsonParse<any[]>(r.recommendations, []),
      raw: undefined,
    })),
  });
});

apiRoutes.post('/insights/generate', async (c) => {
  const r = await generateInsights(c.env);
  return c.json(r, r.ok ? 200 : 500);
});

// ---------------- settings & events ----------------
apiRoutes.get('/settings', async (c) => {
  return c.json({ settings: await getSettings(c.env) });
});

apiRoutes.put('/settings', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const v = validateSettings(body || {});
  if (!v.ok) return c.json({ error: 'invalid settings', errors: v.errors }, 400);
  await saveSettings(c.env, v.clean);
  await logEvent(c.env, 'info', 'api', `Settings updated: ${Object.keys(v.clean).join(', ')}`);
  return c.json({ ok: true, settings: await getSettings(c.env) });
});

apiRoutes.post('/settings/test-email', async (c) => {
  const settings = await getSettings(c.env);
  const r = await sendMail(c.env, {
    to: settings.reminder_email,
    subject: 'Reel Factory: test email',
    text: 'This is a test email from Reel Factory. If you received it, email reminders are working.',
  });
  return c.json({ ok: r.ok, provider: r.provider, detail: r.detail || null });
});

apiRoutes.get('/events', async (c) => {
  const rows = await listEvents(c.env, {
    limit: Number(c.req.query('limit') || 50),
    level: c.req.query('level') || undefined,
  });
  return c.json({ events: rows.map((e: any) => ({ ...e, data: jsonParse(e.data, null) })) });
});
