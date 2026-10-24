// Publishing state machine: schedule -> claim -> (dry-run | container -> poll -> publish).
// Duplicate-post prevention: atomic status claim on the publications row.
import type { Env } from '../lib/env';
import { all, one, run, nowIso } from '../lib/db';
import { logEvent } from '../lib/events';
import { getSettings } from '../lib/settings';
import { shortId } from '../lib/crypto';
import { scheduledForMs } from '../shared/weektime.mjs';
import { instagramConfigured, createReelContainer, containerStatus, publishContainer, publishingLimit } from './instagram';

function buildCaption(reel: any, settings: Record<string, string>, pubCaption?: string): string {
  let hashtags: string[] = [];
  let defaults: string[] = [];
  try { hashtags = JSON.parse(reel.hashtags || '[]'); } catch { /* noop */ }
  try { defaults = JSON.parse(settings.default_hashtags || '[]'); } catch { /* noop */ }
  const tags = [...new Set([...hashtags, ...defaults])].slice(0, 12);
  return [pubCaption || reel.caption || reel.title, tags.join(' '), settings.caption_suffix]
    .filter(Boolean).join(' ').slice(0, 2200);
}

export async function schedulePublication(
  env: Env, reelId: string, scheduledAtIso?: string, autoApproved = false,
): Promise<any> {
  const reel = await one<any>(env, 'SELECT * FROM reels WHERE id = ?', reelId);
  if (!reel) throw new Error('reel not found');
  const settings = await getSettings(env);
  let iso = scheduledAtIso;
  if (!iso) {
    let ms = scheduledForMs(reel.week_start, reel.day_index, settings.posting_time, settings.timezone);
    if (ms <= Date.now()) ms = Date.now() + 5 * 60 * 1000;
    iso = new Date(ms).toISOString();
  } else if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) {
    throw new Error('scheduledAtIso must be an ISO-8601 timestamp');
  }
  const existing = await one<any>(env, 'SELECT * FROM publications WHERE reel_id = ?', reelId);
  if (existing && ['published', 'publishing'].includes(existing.status)) {
    throw new Error(`publication already ${existing.status}`);
  }
  if (existing) {
    await run(env,
      `UPDATE publications SET status='scheduled', scheduled_for=?, auto_approved=?, updated_at=? WHERE id=?`,
      iso, autoApproved ? 1 : 0, nowIso(), existing.id);
  } else {
    await run(env,
      `INSERT INTO publications(id, reel_id, status, scheduled_for, auto_approved, caption, created_at, updated_at)
       VALUES (?,?,'scheduled',?,?,?,?,?)`,
      shortId('pub'), reelId, iso, autoApproved ? 1 : 0, reel.caption || '', nowIso(), nowIso());
  }
  await run(env, `UPDATE reels SET status='scheduled', updated_at=? WHERE id=?`, nowIso(), reelId);
  await logEvent(env, 'info', 'publisher', `Publishing scheduled for ${iso}`, { reel: reelId });
  return one(env, 'SELECT * FROM publications WHERE reel_id = ?', reelId);
}

export async function cancelPublication(env: Env, reelId: string): Promise<void> {
  const pub = await one<any>(env, 'SELECT * FROM publications WHERE reel_id = ?', reelId);
  if (!pub) throw new Error('no publication for reel');
  if (pub.status === 'published') throw new Error('already published - cannot cancel');
  await run(env, `UPDATE publications SET status='cancelled', updated_at=? WHERE id=?`, nowIso(), pub.id);
  await run(env, `UPDATE reels SET status='rendered', updated_at=? WHERE id=?`, nowIso(), reelId);
  await logEvent(env, 'info', 'publisher', 'Publication cancelled', { reel: reelId });
}

export async function publishDue(env: Env): Promise<{ attempted: number; published: number; dryRun: number; failed: number }> {
  const now = nowIso();
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const due = await all<any>(env, `
    SELECT p.id AS pub_id, p.reel_id AS rid
    FROM publications p JOIN reels r ON r.id = p.reel_id
    WHERE ( (p.status IN ('scheduled','failed') AND p.scheduled_for <= ?)
         OR (p.status = 'publishing' AND p.updated_at < ?) )
      AND r.status IN ('rendered','scheduled','publish_failed','publishing')
    ORDER BY p.scheduled_for LIMIT 5`, now, staleCutoff);
  let published = 0, dryRun = 0, failed = 0;
  for (const d of due) {
    try {
      const r = await attemptPublish(env, d.rid);
      if (r === 'published') published++;
      else if (r === 'dry_run') dryRun++;
      else failed++;
    } catch (e: any) {
      failed++;
      await logEvent(env, 'error', 'publisher', `attemptPublish threw: ${e?.message || e}`, { reel: d.rid });
    }
  }
  return { attempted: due.length, published, dryRun, failed };
}

export async function attemptPublish(env: Env, reelId: string): Promise<'published' | 'dry_run' | 'failed'> {
  const pub = await one<any>(env, 'SELECT * FROM publications WHERE reel_id = ?', reelId);
  if (!pub) throw new Error('no publication row for reel');
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE publications SET status='publishing', attempts = attempts + 1, updated_at=?
     WHERE id=? AND (status IN ('scheduled','failed') OR (status='publishing' AND updated_at < ?))`,
  ).bind(nowIso(), pub.id, staleCutoff).run();
  if (!claim.meta || !claim.meta.changes) {
    const cur = await one<any>(env, 'SELECT status FROM publications WHERE id=?', pub.id);
    return cur?.status === 'published' ? 'published' : 'failed';
  }
  const reel = await one<any>(env, 'SELECT * FROM reels WHERE id = ?', reelId);
  const settings = await getSettings(env);
  await run(env, `UPDATE reels SET status='publishing', updated_at=? WHERE id=?`, nowIso(), reelId);

  // DRY RUN when Instagram is not configured (never silently fake a post)
  if (!instagramConfigured(env)) {
    await run(env, `UPDATE publications SET status='dry_run', updated_at=? WHERE id=?`, nowIso(), pub.id);
    await run(env, `UPDATE reels SET status='dry_run', updated_at=? WHERE id=?`, nowIso(), reelId);
    await logEvent(env, 'info', 'publisher',
      `DRY RUN: would publish "${reel.title}" to Instagram. Configure IG_USER_ID + IG_ACCESS_TOKEN to enable live publishing.`,
      { reel: reelId });
    return 'dry_run';
  }

  try {
    const media = await one<any>(env,
      `SELECT url FROM media_assets WHERE reel_id=? AND kind='mp4' AND storage='r2'
       ORDER BY created_at DESC LIMIT 1`, reelId);
    if (!media?.url) throw new Error('no public MP4 URL - render with R2 storage and set app_origin');

    const limitUsed = await publishingLimit(env);
    if (limitUsed !== null && limitUsed >= 90) {
      throw new Error(`Instagram publishing quota nearly exhausted (${limitUsed}/100 in 24h) - retrying later is safe`);
    }

    let containerId: string | undefined = pub.ig_container_id || undefined;
    if (!containerId) {
      const caption = buildCaption(reel, settings, pub.caption);
      const created = await createReelContainer(env, { videoUrl: media.url, caption });
      containerId = created.id;
      await run(env, `UPDATE publications SET ig_container_id=?, updated_at=? WHERE id=?`, containerId, nowIso(), pub.id);
    }

    // short in-band poll; long transcodes resume on the next hourly tick
    let st = 'IN_PROGRESS';
    for (let i = 0; i < 4; i++) {
      st = await containerStatus(env, containerId);
      if (st === 'FINISHED' || st === 'ERROR') break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (st === 'ERROR') {
      throw new Error('container status ERROR - Instagram could not fetch/transcode the video URL (see docs: known transient issue 2207076)');
    }
    if (st !== 'FINISHED') {
      await logEvent(env, 'warn', 'publisher', 'Container still processing; resuming next tick',
        { reel: reelId, container: containerId });
      return 'failed';
    }

    const published = await publishContainer(env, containerId);
    await run(env,
      `UPDATE publications SET status='published', ig_media_id=?, published_at=?, updated_at=? WHERE id=?`,
      published.id, nowIso(), nowIso(), pub.id);
    await run(env, `UPDATE reels SET status='published', updated_at=? WHERE id=?`, nowIso(), reelId);
    await logEvent(env, 'info', 'publisher', `Published to Instagram: ${reel.title}`,
      { reel: reelId, ig_media_id: published.id });
    return 'published';
  } catch (e: any) {
    await run(env,
      `UPDATE publications SET status='failed', last_error=?, updated_at=? WHERE id=?`,
      String(e?.message || e).slice(0, 800), nowIso(), pub.id);
    await run(env, `UPDATE reels SET status='publish_failed', updated_at=? WHERE id=?`, nowIso(), reelId);
    await logEvent(env, 'error', 'publisher', `Publish failed: ${e?.message || e}`, { reel: reelId });
    return 'failed';
  }
}
