import { Env, Scene } from './types';
import { splitScript } from './gemini';
import { dispatchRender } from './render';
import { runReminder, runDailyPost, runLearner, currentWeekStart, createReelSlots } from './cron';
import { dashboardHtml } from './ui';

// ── Entry: fetch router + scheduled handler ──
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (req.method === 'GET' && (path === '/' || path === '/dashboard')) {
        return new Response(dashboardHtml(env), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      // ── API: receive weekly script ──
      if (req.method === 'POST' && path === '/api/script') {
        const { script } = await req.json<{ script: string }>();
        if (!script || script.trim().length < 40) {
          return json({ ok: false, error: 'Script too short — paste the full weekly script (min 40 chars).' }, 400);
        }
        const ws = currentWeekStart();
        const existing = await env.DB.prepare('SELECT id FROM weeks WHERE week_start = ?').bind(ws).first();
        if (existing) {
          await env.DB.prepare("UPDATE weeks SET script = ?, status = 'script_received' WHERE id = ?")
            .bind(script.trim(), existing.id).run();
          return json({ ok: true, message: `Script updated for week of ${ws}` });
        }
        const r = await env.DB.prepare('INSERT INTO weeks (week_start, script) VALUES (?, ?)')
          .bind(ws, script.trim()).run();
        await createReelSlots(env, Number(r.meta.last_row_id), []);
        return json({ ok: true, message: `Script received for week of ${ws}. Hit "Split into scenes" next.` });
      }

      // ── API: Gemini split script -> scenes ──
      if (req.method === 'POST' && path === '/api/split') {
        const ws = currentWeekStart();
        const week = await env.DB.prepare('SELECT * FROM weeks WHERE week_start = ?').bind(ws).first<{ id: number; script: string }>();
        if (!week) return json({ ok: false, error: 'No script yet for this week.' }, 400);
        const lessonsRows = await env.DB.prepare('SELECT body FROM lessons ORDER BY created_at DESC LIMIT 3').all<{ body: string }>();
        const lessons = (lessonsRows.results ?? []).map(r => r.body);
        if (lessons.length) {
          await env.DB.prepare('UPDATE weeks SET lessons_used = ? WHERE id = ?').bind(lessons.join('\n'), week.id).run();
        }
        try {
          const scenes = await splitScript(env, week.script, lessons);
          await env.DB.prepare('DELETE FROM scenes WHERE week_id = ?').bind(week.id).run();
          for (const s of scenes) {
            await env.DB.prepare(
              `INSERT INTO scenes (week_id, idx, kind, duration, headline, lines, caption, narration, accent)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(week.id, s.idx, s.kind, s.duration, s.headline, JSON.stringify(s.lines ?? []),
                   s.caption ?? '', s.narration ?? '', s.accent ?? '#4C6EF5').run();
          }
          await env.DB.prepare("UPDATE weeks SET status = 'split' WHERE id = ?").bind(week.id).run();
          return json({ ok: true, message: `${scenes.length} scenes created. You can now render reels.`, scenes });
        } catch (e: any) {
          return json({ ok: false, error: String(e.message || e).slice(0, 300) }, 500);
        }
      }

      // ── API: dispatch one reel render (default: day 0 master reel) ──
      if (req.method === 'POST' && path === '/api/render') {
        const ws = currentWeekStart();
        const week = await env.DB.prepare('SELECT id FROM weeks WHERE week_start = ?').bind(ws).first<{ id: number }>();
        if (!week) return json({ ok: false, error: 'No script this week.' }, 400);
        const rows = await env.DB.prepare('SELECT * FROM scenes WHERE week_id = ? ORDER BY idx').all<any>();
        const scenes: Scene[] = (rows.results ?? []).map(r => ({
          idx: r.idx, kind: r.kind, duration: r.duration, headline: r.headline,
          lines: JSON.parse(r.lines || '[]'), caption: r.caption, narration: r.narration, accent: r.accent,
        }));
        if (!scenes.length) return json({ ok: false, error: 'No scenes yet — split first.' }, 400);
        const reel = await env.DB.prepare(
          `SELECT id FROM reels WHERE week_id = ? AND post_day = 0 LIMIT 1`
        ).bind(week.id).first<{ id: number }>();
        if (!reel) return json({ ok: false, error: 'Reel slot missing.' }, 400);
        const d = await dispatchRender(env, week.id, reel.id, scenes);
        if (d.ok) await env.DB.prepare("UPDATE weeks SET status = 'rendering' WHERE id = ?").bind(week.id).run();
        return json({ ok: d.ok, message: d.detail });
      }

      // ── Render callback: Actions POSTs finished mp4 here ──
      if (req.method === 'POST' && path === '/api/reels/upload') {
        if (!env.RENDER_SECRET || req.headers.get('X-Render-Secret') !== env.RENDER_SECRET) {
          return json({ ok: false, error: 'bad render secret' }, 401);
        }
        const form = await req.formData();
        const reelId = Number(form.get('reelId'));
        const file = form.get('file') as File | null;
        if (!reelId || !file) return json({ ok: false, error: 'reelId and file required' }, 400);
        const key = `reels/${reelId}_${Date.now()}.mp4`;
        await env.REELS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'video/mp4' } });
        const publicBase = url.origin.replace(/\/$/, ''); // r2 public URL configured separately
        await env.DB.prepare("UPDATE reels SET video_url = ?, render_status = 'rendered' WHERE id = ?")
          .bind(`${env.WORKER_URL}/reel/${reelId}`, reelId).run();
        await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .bind(`r2key_${reelId}`, key).run();
        return json({ ok: true, message: `reel ${reelId} stored at ${key}` });
      }

      // ── Serve a stored reel by id (public URL used by IG container) ──
      if (req.method === 'GET' && path.startsWith('/reel/')) {
        const reelId = path.split('/')[2];
        const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(`r2key_${reelId}`).first<{ value: string }>();
        if (!row) return new Response('Not found', { status: 404 });
        const obj = await env.REELS.get(row.value);
        if (!obj) return new Response('Not found', { status: 404 });
        return new Response(obj.body, { headers: { 'Content-Type': 'video/mp4' } });
      }

      // ── Status endpoint ──
      if (req.method === 'GET' && path === '/api/status') {
        const ws = currentWeekStart();
        const week = await env.DB.prepare('SELECT * FROM weeks WHERE week_start = ?').bind(ws).first();
        const scenes = await env.DB.prepare(
          'SELECT idx, kind, headline, duration FROM scenes WHERE week_id = (SELECT id FROM weeks WHERE week_start = ?) ORDER BY idx'
        ).bind(ws).all();
        const reels = await env.DB.prepare(
          `SELECT r.id, r.post_day, r.render_status, r.video_url, r.ig_media_id, r.posted_at
           FROM reels r JOIN weeks w ON w.id = r.week_id WHERE w.week_start = ? ORDER BY r.post_day`
        ).bind(ws).all();
        const lessons = await env.DB.prepare('SELECT body, created_at FROM lessons ORDER BY created_at DESC LIMIT 5').all();
        const reminders = await env.DB.prepare('SELECT sent_at, channel FROM reminders ORDER BY sent_at DESC LIMIT 5').all();
        return json({ ok: true, week: ws, hasScript: !!week, weekStatus: (week as any)?.status ?? 'awaiting_script', scenes: scenes.results, reels: reels.results, lessons: lessons.results, reminders: reminders.results });
      }

      return json({ ok: false, error: 'Not found' }, 404);
    } catch (e: any) {
      return json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
    }
  },

  // ── Cron dispatcher ──
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const expr = event.cron;
    let result: string;
    if (expr.startsWith('30 2')) result = await runReminder(env);
    else if (expr.startsWith('0 13')) result = await runDailyPost(env);
    else if (expr.startsWith('30 16')) result = await runLearner(env);
    else result = 'unknown cron';
    console.log(`[cron ${expr}] ${result}`);
  },
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
