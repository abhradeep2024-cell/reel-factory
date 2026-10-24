// Render job queue: enqueue, atomic claim (unique token), result intake,
// R2 media upload (streaming), stale-job recovery.
import type { Env } from '../lib/env';
import { all, one, run, nowIso, jsonParse } from '../lib/db';
import { logEvent } from '../lib/events';
import { getSettings } from '../lib/settings';
import { shortId } from '../lib/crypto';
import { scheduledForMs } from '../shared/weektime.mjs';
import { REEL } from '../shared/shotsheet.mjs';

export async function enqueueRender(env: Env, reelId: string): Promise<string | null> {
  const reel = await one<any>(env, 'SELECT * FROM reels WHERE id = ?', reelId);
  if (!reel) throw new Error('reel not found');
  if (!['planned', 'render_failed', 'rendered', 'queued'].includes(reel.status)) return null;
  const active = await one<any>(
    env,
    `SELECT COUNT(*) AS n FROM render_jobs WHERE reel_id = ? AND status IN ('queued','claimed','running')`,
    reelId,
  );
  if (active && active.n > 0) return null;
  const id = shortId('job');
  await run(env,
    `INSERT INTO render_jobs(id, reel_id, status, attempts, max_attempts, created_at, updated_at)
     VALUES (?,?,'queued',0,3,?,?)`, id, reelId, nowIso(), nowIso());
  await run(env, `UPDATE reels SET status = 'queued', updated_at = ? WHERE id = ?`, nowIso(), reelId);
  await logEvent(env, 'info', 'render', `Render job queued`, { reel: reelId, job: id });
  return id;
}

export async function claimJob(env: Env, runnerHint: string): Promise<any | null> {
  const token = shortId('run');
  await run(env,
    `UPDATE render_jobs
       SET status='claimed', claimed_at=?, started_at=?, runner=?, attempts=attempts+1, updated_at=?
     WHERE id = (SELECT id FROM render_jobs WHERE status='queued' AND attempts < max_attempts
                 ORDER BY created_at LIMIT 1)`,
    nowIso(), nowIso(), token, nowIso());
  const job = await one<any>(
    env,
    `SELECT * FROM render_jobs WHERE runner = ? AND status='claimed' ORDER BY started_at DESC LIMIT 1`,
    token,
  );
  if (!job) return null;
  const reel = await one<any>(env, 'SELECT * FROM reels WHERE id = ?', job.reel_id);
  if (!reel) return null;
  await run(env, `UPDATE render_jobs SET status='running', updated_at=? WHERE id=?`, nowIso(), job.id);
  await run(env, `UPDATE reels SET status='rendering', updated_at=? WHERE id=?`, nowIso(), reel.id);
  return {
    job_id: job.id,
    reel_id: reel.id,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    week_start: reel.week_start,
    day_index: reel.day_index,
    title: reel.title,
    plan: jsonParse(reel.shot_sheet, null),
    render: { width: REEL.width, height: REEL.height, fps: REEL.fps, target_duration_sec: REEL.targetDurationSec },
  };
}

export async function receiveResult(env: Env, payload: any): Promise<{ ok: boolean; ignored?: boolean }> {
  const { job_id, status, error, meta } = payload || {};
  const job = await one<any>(env, 'SELECT * FROM render_jobs WHERE id = ?', job_id);
  if (!job) throw new Error('job not found');
  if (job.status === 'succeeded' || job.status === 'cancelled') return { ok: true, ignored: true };

  if (status === 'succeeded') {
    await run(env,
      `UPDATE render_jobs SET status='succeeded', finished_at=?, mp4_bytes=?, duration_sec=?, width=?, height=?, fps=?, updated_at=?
       WHERE id=?`,
      nowIso(), meta?.bytes ?? null, meta?.duration_sec ?? null, meta?.width ?? null,
      meta?.height ?? null, meta?.fps ?? null, nowIso(), job_id);
    await run(env, `UPDATE reels SET status='rendered', updated_at=? WHERE id=?`, nowIso(), job.reel_id);
    await autoSchedule(env, job.reel_id);
    await logEvent(env, 'info', 'render',
      `Reel rendered (${meta?.duration_sec ?? '?'}s, ${Math.round((meta?.bytes || 0) / 1e6)}MB)`,
      { reel: job.reel_id, job: job_id });
    return { ok: true };
  }

  await run(env,
    `UPDATE render_jobs SET status='failed', finished_at=?, last_error=?, updated_at=? WHERE id=?`,
    nowIso(), String(error || 'render failed').slice(0, 900), nowIso(), job_id);
  await run(env,
    `UPDATE reels SET status='render_failed', updated_at=? WHERE id=? AND status NOT IN ('published','dry_run')`,
    nowIso(), job.reel_id);
  await logEvent(env, 'error', 'render',
    `Render failed (attempt ${job.attempts}/${job.max_attempts}): ${String(error || '').slice(0, 200)}`,
    { reel: job.reel_id, job: job_id, will_retry: job.attempts < job.max_attempts });
  return { ok: true };
}

async function autoSchedule(env: Env, reelId: string): Promise<void> {
  const settings = await getSettings(env);
  if (settings.auto_approve_publish !== 'true') return;
  const existing = await one(env, 'SELECT id FROM publications WHERE reel_id = ?', reelId);
  if (existing) return;
  const reel = await one<any>(env, 'SELECT * FROM reels WHERE id = ?', reelId);
  if (!reel) return;
  let schedMs = scheduledForMs(reel.week_start, reel.day_index, settings.posting_time, settings.timezone);
  if (schedMs <= Date.now()) schedMs = Date.now() + 5 * 60 * 1000;
  const iso = new Date(schedMs).toISOString();
  await run(env,
    `INSERT INTO publications(id, reel_id, status, scheduled_for, auto_approved, caption, created_at, updated_at)
     VALUES (?,?,'scheduled',?,1,?,?,?)`,
    shortId('pub'), reelId, iso, reel.caption || '', nowIso(), nowIso());
  await run(env, `UPDATE reels SET status='scheduled', updated_at=? WHERE id=?`, nowIso(), reelId);
  await logEvent(env, 'info', 'publisher', `Auto-scheduled for ${iso}`, { reel: reelId });
}

const MAX_UPLOAD_BYTES = 120 * 1024 * 1024;

export async function uploadMedia(
  env: Env,
  jobId: string,
  kind: 'mp4' | 'thumbnail',
  request: Request,
): Promise<{ url: string | null; storage: string }> {
  const job = await one<any>(env, 'SELECT * FROM render_jobs WHERE id = ?', jobId);
  if (!job) throw new Error('job not found');
  const reel = await one<any>(env, 'SELECT * FROM reels WHERE id = ?', job.reel_id);
  if (!reel) throw new Error('reel not found');
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_UPLOAD_BYTES) throw new Error(`body too large (${len} bytes)`);

  const key = `${reel.week_start}/${reel.id}/${kind === 'thumbnail' ? 'thumb.jpg' : 'reel.mp4'}`;
  if (!env.MEDIA) {
    await logEvent(env, 'warn', 'render',
      'Media upload skipped: R2 not configured (deploy with wrangler.r2.jsonc to store videos)',
      { job: jobId, kind });
    return { url: null, storage: 'none' };
  }
  if (!request.body) throw new Error('empty body');
  const contentType = request.headers.get('content-type') ||
    (kind === 'thumbnail' ? 'image/jpeg' : 'video/mp4');
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType } });

  const settings = await getSettings(env);
  const origin = (settings.app_origin || env.APP_ORIGIN || '').replace(/\/+$/, '');
  const url = origin ? `${origin}/media/${key}` : `/media/${key}`;
  await run(env,
    `INSERT INTO media_assets(id, reel_id, kind, storage, storage_key, url, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    shortId('med'), reel.id, kind, 'r2', key, url, len, nowIso());
  if (!origin) {
    await logEvent(env, 'warn', 'render',
      'app_origin is not set - media URL is relative. Set it in Settings so Instagram can fetch the video.',
      { job: jobId });
  }
  return { url, storage: 'r2' };
}

export async function recoverStaleJobs(env: Env, maxAgeMs = 45 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const stale = await all<any>(env,
    `SELECT id, reel_id, attempts, max_attempts FROM render_jobs
     WHERE status IN ('claimed','running') AND started_at < ?`, cutoff);
  for (const j of stale) {
    if (j.attempts >= j.max_attempts) {
      await run(env,
        `UPDATE render_jobs SET status='failed', last_error='job timed out', finished_at=?, updated_at=? WHERE id=?`,
        nowIso(), nowIso(), j.id);
      await run(env, `UPDATE reels SET status='render_failed', updated_at=? WHERE id=?`, nowIso(), j.reel_id);
      await logEvent(env, 'error', 'render', `Render job timed out`, { job: j.id, reel: j.reel_id });
    } else {
      await run(env, `UPDATE render_jobs SET status='queued', updated_at=? WHERE id=?`, nowIso(), j.id);
      await logEvent(env, 'warn', 'render', 'Stale render job requeued', { job: j.id });
    }
  }
  return stale.length;
}
