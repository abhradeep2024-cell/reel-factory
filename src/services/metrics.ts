// Metrics: sync from Instagram Insights into snapshots; build comparison items
// for the learning loop. Only records what the API actually returns.
import type { Env } from '../lib/env';
import { all, run, nowIso, jsonParse } from '../lib/db';
import { logEvent } from '../lib/events';
import { getSettings } from '../lib/settings';
import { shortId } from '../lib/crypto';
import { instagramConfigured, fetchReelInsights, fetchMediaFields } from './instagram';
import { computeEngagementRate, latestByReel } from '../shared/engagement.mjs';
import { localParts } from '../shared/weektime.mjs';

export async function syncMetrics(env: Env): Promise<{ updated: number; skipped: number }> {
  if (!instagramConfigured(env)) {
    await logEvent(env, 'info', 'metrics', 'Metrics sync skipped: Instagram not configured');
    return { updated: 0, skipped: 0 };
  }
  const reels = await all<any>(env, `
    SELECT r.*, p.ig_media_id, p.published_at
    FROM reels r JOIN publications p ON p.reel_id = r.id
    WHERE r.status = 'published' AND p.ig_media_id IS NOT NULL`);
  let updated = 0, skipped = 0;
  for (const reel of reels) {
    try {
      const { metrics, raw } = await fetchReelInsights(env, reel.ig_media_id);
      const fields = await fetchMediaFields(env, reel.ig_media_id, 'permalink,timestamp').catch(() => ({}));
      const ageHours = reel.published_at
        ? (Date.now() - new Date(reel.published_at).getTime()) / 3600000 : null;
      const m = {
        views: metrics.views ?? metrics.plays ?? null,
        reach: metrics.reach ?? null,
        impressions: metrics.impressions ?? null,
        likes: metrics.likes ?? null,
        comments: metrics.comments ?? null,
        shares: metrics.shares ?? null,
        saves: metrics.saves ?? null,
      };
      if (Object.values(m).every((v) => v == null)) { skipped++; continue; }
      const er = computeEngagementRate(m);
      await run(env,
        `INSERT INTO metric_snapshots(id, reel_id, age_hours, views, reach, impressions, likes, comments, shares, saves, engagement_rate, raw)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        shortId('ms'), reel.id, ageHours == null ? null : Math.round(ageHours * 10) / 10,
        m.views, m.reach, m.impressions, m.likes, m.comments, m.shares, m.saves, er,
        JSON.stringify(raw).slice(0, 100000));
      if (fields?.permalink) {
        await run(env, `UPDATE publications SET permalink=? WHERE reel_id=? AND (permalink IS NULL OR permalink='')`,
          fields.permalink, reel.id);
      }
      updated++;
    } catch (e: any) {
      skipped++;
      await logEvent(env, 'warn', 'metrics',
        `Insights fetch failed for reel ${reel.id}: ${e?.message || e}`);
    }
  }
  if (updated) await logEvent(env, 'info', 'metrics', `Synced metrics for ${updated} reel(s)`, { skipped });
  return { updated, skipped };
}

export async function comparisonItems(env: Env): Promise<any[]> {
  const settings = await getSettings(env);
  const reels = await all<any>(env, `
    SELECT r.*, p.published_at FROM reels r
    JOIN publications p ON p.reel_id = r.id
    WHERE r.status IN ('published','dry_run')
    ORDER BY r.week_start DESC, r.day_index ASC LIMIT 28`);
  const snaps = await all<any>(env, 'SELECT * FROM metric_snapshots ORDER BY captured_at ASC');
  const latest = latestByReel(snaps);
  const items: any[] = [];
  for (const reel of reels) {
    const plan = jsonParse<any>(reel.shot_sheet, {});
    const metrics = latest.get(reel.id) || null;
    const pubHour = reel.published_at
      ? localParts(new Date(reel.published_at).getTime(), settings.timezone).h : null;
    items.push({
      reel: {
        id: reel.id,
        week_start: reel.week_start,
        day_index: reel.day_index,
        title: reel.title,
        hook_style: plan.hook_style,
        template: plan.template,
        duration_sec: plan.duration_sec,
        publish_hour_local: pubHour,
      },
      metrics,
    });
  }
  return items;
}
