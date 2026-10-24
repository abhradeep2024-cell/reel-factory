import { Env, Week, Scene, Reel } from './types';
import { postReel, getInsights, sendReminderEmail } from './instagram';
import { distillLessons } from './gemini';

// ── Cron brains ──

// Current week_start = most recent Sunday (UTC date string)
export function currentWeekStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // back to Sunday
  return d.toISOString().slice(0, 10);
}

// CRON 1 (02:30 UTC / 08:00 IST): remind only if this week's script is missing
export async function runReminder(env: Env): Promise<string> {
  const ws = currentWeekStart();
  const row = await env.DB.prepare('SELECT id, status FROM weeks WHERE week_start = ?').bind(ws).first();
  if (row) return `script already received for week ${ws} — no reminder`;
  const sent = await sendReminderEmail(
    env,
    '☕ Your weekly script is missing — 5 minutes is enough',
    `<p>Good morning! You haven't sent this week's script yet.</p>
     <p><a href="${env.WORKER_URL}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Paste it now (5 min)</a></p>
     <p>This nudge repeats every morning until you send it — sending is the only way to stop it. 🙂</p>`
  );
  await env.DB.prepare('INSERT INTO reminders (week_start, channel, kind) VALUES (?, ?, ?)')
    .bind(ws, sent ? 'email' : 'dryrun', 'script_reminder').run();
  return sent ? `reminder emailed for ${ws}` : `reminder DRY-RUN logged for ${ws} (set RESEND_API_KEY to actually email)`;
}

// CRON 2 (13:00 UTC / 18:30 IST): post today's reel if rendered and not yet posted
export async function runDailyPost(env: Env): Promise<string> {
  const ws = currentWeekStart();
  const day = new Date().getUTCDay();
  const reel = await env.DB.prepare(
    `SELECT * FROM reels WHERE week_id = (SELECT id FROM weeks WHERE week_start = ?)
     AND post_day = ? AND render_status = 'rendered' AND posted_at IS NULL LIMIT 1`
  ).bind(ws, day).first<Reel>();
  if (!reel) return `no rendered reel to post today (day ${day})`;
  if (!reel.video_url) return 'reel missing video_url';

  const mediaId = await postReel(env, reel.video_url, reel.caption);
  await env.DB.prepare('UPDATE reels SET ig_media_id = ?, posted_at = datetime(\'now\') WHERE id = ?')
    .bind(mediaId, reel.id).run();
  return mediaId ? `posted reel ${reel.id} -> media ${mediaId}` : `DRY-RUN: reel ${reel.id} marked posted (IG secrets pending)`;
}

// CRON 3 (16:30 UTC / 22:00 IST): pull insights, distill lessons
export async function runLearner(env: Env): Promise<string> {
  const posted = await env.DB.prepare(
    `SELECT r.id, r.caption, r.ig_media_id, w.week_start FROM reels r
     JOIN weeks w ON w.id = r.week_id
     WHERE r.ig_media_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM insights i WHERE i.reel_id = r.id AND i.captured_at > datetime('now','-24 hours'))
     ORDER BY r.posted_at DESC LIMIT 7`
  ).all<{ id: number; caption: string; ig_media_id: string; week_start: string }>();
  if (!posted.results?.length) return 'no posted reels need insight capture';

  let lines: string[] = [];
  for (const r of posted.results) {
    const ins = await getInsights(env, r.ig_media_id);
    if (!ins) continue;
    await env.DB.prepare(
      `INSERT INTO insights (reel_id, plays, likes, comments, saves, reach)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(r.id, ins.plays ?? null, ins.likes ?? null, ins.comments ?? null, ins.saves ?? null, ins.reach ?? null).run();
    lines.push(`week ${r.week_start}: plays=${ins.plays ?? '?'} likes=${ins.likes ?? '?'} saves=${ins.saves ?? '?'} reach=${ins.reach ?? '?'} caption="${r.caption.slice(0, 60)}"`);
  }
  if (!lines.length) return 'insights unavailable (IG creds or metrics pending)';

  const lessons = await distillLessons(env, lines.join('\n'));
  if (lessons) {
    await env.DB.prepare('INSERT INTO lessons (body, metrics_json) VALUES (?, ?)')
      .bind(lessons, JSON.stringify(lines)).run();
  }
  return `captured ${lines.length} reels' insights${lessons ? ' + distilled 3 new lessons' : ''}`;
}

// Helper used by API routes: create 7 reel slots for a week
export async function createReelSlots(env: Env, weekId: number, captions: string[]): Promise<void> {
  for (let day = 0; day < 7; day++) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO reels (week_id, post_day, caption) VALUES (?, ?, ?)`
    ).bind(weekId, day, captions[day] ?? `Day ${day + 1} — from this week's script`).run();
  }
}
