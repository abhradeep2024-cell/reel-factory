/**
 * Auto-Reel Factory — The Brain (Cloudflare Worker)
 * Dashboard + API + cron jobs + AI scene generation + Instagram posting + learning loop.
 * All credentials come from runtime secrets — nothing sensitive in code.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/* ─────────────────────────── helpers ─────────────────────────── */

const enc = new TextEncoder();

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }

function nowIST() {
  const d = new Date(Date.now() + 330 * 60 * 1000); // IST = UTC+5:30
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 16),
    dow: d.getUTCDay(), // 0=Sun
    weekStart: weekStartIST(),
  };
}

function weekStartIST() {
  const d = new Date(Date.now() + 330 * 60 * 1000);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - dow); // back to Sunday
  return d.toISOString().slice(0, 10);
}

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

async function log(env, kind, message) {
  try { await env.DB.prepare('INSERT INTO log (kind, message) VALUES (?, ?)').bind(kind, String(message).slice(0, 900)).run(); }
  catch (e) { console.error('log failed', e.message); }
}

async function getSetting(env, key, fallback = null) {
  try { const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first(); return r ? r.value : fallback; }
  catch { return fallback; }
}
async function setSetting(env, key, value) { await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run(); }

/* ─────────────────────────── auth ─────────────────────────── */

async function isAuthed(request, env) {
  const pass = env.DASHBOARD_PASSPHRASE;
  if (!pass) return false; // not configured -> force login view with setup note
  const cookie = (request.headers.get('Cookie') || '').match(/rf_session=([a-f0-9]+)/);
  if (!cookie) return false;
  return cookie[1] === (await hmacHex(env.WORKER_API_KEY || 'rf-dev', 'session:' + pass));
}

/* ─────────────────────────── AI scene generation ─────────────────────────── */

function buildScenePrompt(script, lessons) {
  const lessonBlock = lessons.length
    ? `Performance lessons from earlier reels (apply them):\n${lessons.map(l => '- ' + l).join('\n')}\n`
    : '';
  return `You are a short-form video director for Instagram reels (9:16, 60 seconds each).
From the user's WEEKLY SCRIPT below, produce exactly SEVEN reels (one per day).
Each reel = 6 scenes x 10 seconds. Scene kinds allowed: "hook" (must be scene 1 of each reel - a 3-6 word pattern-interrupt), "point", "list", "quote", "cta".
The hook scene decides whether people stop scrolling - make each of the 7 hooks different in style (question, bold claim, number, contrarian, curiosity gap, challenge, secret).
Keep on-screen text short: headline <= 8 words, body <= 24 words. Use simple words a 15-year-old understands.
${lessonBlock}
WEEKLY SCRIPT:
"""${script.slice(0, 12000)}"""

Reply with ONLY valid minified JSON, no markdown, shape:
{"reels":[{"day":1,"caption":"<=150 chars with 2-4 hashtags","scenes":[{"kind":"hook","headline":"...","body":"...","keywords":["w1","w2"],"direction":"visual mood in <=8 words"}]}]}`;
}

function extractJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON found in AI reply');
  return JSON.parse(m[0]);
}

async function generateWithGemini(env, prompt) {
  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 8192 } }),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return d.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}

async function generateWithWorkersAI(env, prompt) {
  const r = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages: [{ role: 'user', content: prompt }], max_tokens: 8192 });
  return typeof r === 'string' ? r : (r.response || r.result || '');
}

async function generateScenes(env, script, weekStart) {
  const lessons = (await env.DB.prepare('SELECT summary FROM lessons ORDER BY id DESC LIMIT 3').all().then(x => x.results.map(r => r.summary)).catch(() => []));
  const prompt = buildScenePrompt(script, lessons);
  let raw, usedAI = 'workers-ai';
  if (env.GEMINI_API_KEY) { raw = await generateWithGemini(env, prompt); usedAI = 'gemini'; }
  else raw = await generateWithWorkersAI(env, prompt);
  const parsed = extractJSON(raw);
  if (!parsed.reels || !Array.isArray(parsed.reels) || parsed.reels.length === 0) throw new Error('AI reply missing reels[]');
  await log(env, 'render', `scenes generated for ${weekStart} via ${usedAI}`);
  return { parsed, usedAI };
}

async function persistScenes(env, weekStart, parsed) {
  const days = parsed.reels.slice(0, 7);
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const scheduledDate = addDays(weekStart, i + 1); // post Mon..Sun after Sunday submission
    const r = await env.DB.prepare(
      'INSERT INTO reels (week_start, day_index, scheduled_date, caption, status) VALUES (?,?,?,?,?) RETURNING id'
    ).bind(weekStart, i, scheduledDate, day.caption || '', 'queued').first();
    const reelId = r.id;
    const scenes = (day.scenes || []).slice(0, 6);
    for (let s = 0; s < scenes.length; s++) {
      const sc = scenes[s];
      await env.DB.prepare(
        'INSERT INTO scenes (reel_id, idx, kind, headline, body, keywords, duration_s, direction) VALUES (?,?,?,?,?,?,?,?)'
      ).bind(reelId, s, String(sc.kind || 'point'), String(sc.headline || ''), String(sc.body || ''),
        JSON.stringify(sc.keywords || []), Number(sc.duration_s || 10), String(sc.direction || ''));
    }
  }
}

/* ─────────────────────────── GitHub dispatch ─────────────────────────── */

async function dispatchRender(env, weekStart) {
  if (!env.GH_TOKEN || !env.GH_REPO) { await log(env, 'render', 'render dispatch skipped: GH_TOKEN/GH_REPO not set'); return false; }
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'reel-factory' },
    body: JSON.stringify({ event_type: 'render-week', client_payload: { week: weekStart } }),
  });
  const ok = r.status === 204;
  await log(env, 'render', `repository_dispatch -> ${ok ? 'OK' : 'HTTP ' + r.status}`);
  return ok;
}

/* ─────────────────────────── reminders (email) ─────────────────────────── */

async function sendReminderEmail(env, subject, text) {
  if (!env.RESEND_API_KEY) { await log(env, 'reminder', 'reminder skipped: RESEND_API_KEY not set'); return false; }
  const to = env.REMINDER_EMAIL;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Auto-Reel Factory <onboarding@resend.dev>', to: [to], subject, text }),
  });
  const ok = r.ok;
  await log(env, 'reminder', `email ${ok ? 'sent' : 'failed(' + r.status + ')'} -> ${to}`);
  return ok;
}

async function reminderCheck(env) {
  const t = nowIST();
  const s = await env.DB.prepare('SELECT status FROM scripts WHERE week_start = ?').bind(t.weekStart).first();
  if (s) { await log(env, 'reminder', `script already received for ${t.weekStart}; no reminder`); return; }
  // Daily 8 AM nag until Sunday's script arrives
  await sendReminderEmail(env,
    '⏰ Your weekly script is still missing',
    `Hi! No script received for this week (week of ${t.weekStart}).\n\nOpen your dashboard and paste it — the factory takes over from there.\n\n— Auto-Reel Factory`);
}

/* ─────────────────────────── Instagram posting + insights ─────────────────────────── */

function igReady(env) { return !!(env.IG_ACCESS_TOKEN && env.IG_USER_ID); }

async function igPostReel(env, reel) {
  const videoUrl = `${await publicBase(env)}${reel.video_path}`;
  const caption = (reel.caption || '') + (env.IG_LABEL_AI === 'true' ? '\n\n✨ AI-generated content' : '');
  // 1) create container
  const c = await fetch(`https://graph.facebook.com/v21.0/${env.IG_USER_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'REELS', video_url: videoUrl, caption, access_token: env.IG_ACCESS_TOKEN }),
  });
  const cd = await c.json();
  if (!cd.id) throw new Error('container failed: ' + JSON.stringify(cd).slice(0, 300));
  // 2) wait for finish processing (simple bounded poll)
  let status = 'IN_PROGRESS';
  for (let i = 0; i < 30 && status === 'IN_PROGRESS'; i++) {
    await new Promise(res => setTimeout(res, 10000));
    const st = await (await fetch(`https://graph.facebook.com/v21.0/${cd.id}?fields=status_code&access_token=${env.IG_ACCESS_TOKEN}`)).json();
    status = st.status_code || 'IN_PROGRESS';
  }
  // 3) publish
  const p = await fetch(`https://graph.facebook.com/v21.0/${env.IG_USER_ID}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: cd.id, access_token: env.IG_ACCESS_TOKEN }),
  });
  const pd = await p.json();
  if (!pd.id) throw new Error('publish failed: ' + JSON.stringify(pd).slice(0, 300));
  return pd.id;
}

async function publicBase(env) {
  const custom = await getSetting(env, 'public_base');
  if (custom) return custom.replace(/\/$/, '');
  return `https://${env.WORKER_URL_HOST || 'reel-factory.workers.dev'}`;
}

async function dailyPost(env) {
  if (!igReady(env)) { await log(env, 'post', 'daily post skipped: IG creds not set'); return; }
  const t = nowIST();
  const reel = await env.DB.prepare("SELECT * FROM reels WHERE scheduled_date = ? AND status = 'rendered' ORDER BY day_index LIMIT 1")
    .bind(t.date).first();
  if (!reel) { await log(env, 'post', `no rendered reel scheduled for ${t.date}`); return; }
  try {
    const mediaId = await igPostReel(env, reel);
    await env.DB.prepare("UPDATE reels SET status='posted', posted_at=datetime('now'), ig_media_id=? WHERE id=?").bind(mediaId, reel.id).run();
    await log(env, 'post', `posted reel ${reel.id} -> ig ${mediaId}`);
  } catch (e) {
    await env.DB.prepare("UPDATE reels SET status='failed', error=? WHERE id=?").bind(String(e.message).slice(0, 500), reel.id).run();
    await log(env, 'error', 'post failed: ' + e.message);
  }
  await collectInsights(env); // opportunistic learning-data pull
}

async function collectInsights(env) {
  if (!igReady(env)) return;
  const rows = await env.DB.prepare("SELECT id, ig_media_id FROM reels WHERE ig_media_id IS NOT NULL AND status='posted' ORDER BY id DESC LIMIT 14").all();
  for (const row of rows.results || []) {
    try {
      const url = `https://graph.facebook.com/v21.0/${row.ig_media_id}/insights?metric=plays,reach,likes,comments,saved,total_interactions&access_token=${env.IG_ACCESS_TOKEN}`;
      const d = await (await fetch(url)).json();
      if (!d.data) continue;
      const m = {}; for (const x of d.data) m[x.name] = x.values?.[0]?.value ?? 0;
      const watch = m.total_interactions && m.plays ? Math.min(100, Math.round((m.total_interactions / m.plays) * 1000) / 10) : null;
      await env.DB.prepare(`INSERT INTO insights (ig_media_id, reel_id, plays, reach, likes, comments, saves, avg_watch_pct)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ig_media_id) DO UPDATE SET plays=excluded.plays, reach=excluded.reach,
        likes=excluded.likes, comments=excluded.comments, saves=excluded.saves, avg_watch_pct=excluded.avg_watch_pct, fetched_at=datetime('now')`)
        .bind(row.ig_media_id, row.id, m.plays ?? null, m.reach ?? null, m.likes ?? null, m.comments ?? null, m.saved ?? null, watch).run();
    } catch (e) { await log(env, 'error', 'insights ' + row.ig_media_id + ': ' + e.message); }
  }
}

/* ─────────────────────────── learning loop ─────────────────────────── */

async function weeklyLesson(env) {
  if (!env.DB) return;
  const rows = await env.DB.prepare(`SELECT r.day_index, r.caption, i.plays, i.likes, i.saves, i.avg_watch_pct
    FROM reels r LEFT JOIN insights i ON i.reel_id = r.id WHERE r.status='posted' ORDER BY i.plays DESC NULLS LAST LIMIT 7`).all().catch(() => ({ results: [] }));
  if (!rows.results?.length) return;
  const summaryIn = rows.results.map(r => `day${r.day_index + 1}: plays=${r.plays ?? '?'} likes=${r.likes ?? '?'} saves=${r.saves ?? '?'} watch%=${r.avg_watch_pct ?? '?'} | ${r.caption}`).join('\n');
  const prompt = `These are last week's Instagram reel stats (day1..day7). In <=120 words, list 3-5 concrete, specific lessons about WHICH moments/hooks/formats caught attention and what to change next week. Plain text only.\n${summaryIn}`;
  try {
    let text;
    if (env.GEMINI_API_KEY) text = await generateWithGemini(env, prompt);
    else text = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages: [{ role: 'user', content: prompt }], max_tokens: 400 }).then(r => typeof r === 'string' ? r : r.response);
    await env.DB.prepare('INSERT INTO lessons (week_start, summary) VALUES (?, ?)').bind(nowIST().weekStart, String(text).slice(0, 2000)).run();
    await log(env, 'learn', 'weekly lesson stored');
  } catch (e) { await log(env, 'error', 'lesson failed: ' + e.message); }
}

/* ─────────────────────────── cron ─────────────────────────── */

async function scheduled(controller, env) {
  if (!env.DB) return console.error('DB not bound');
  switch (controller.cron) {
    case '30 2 * * *': await reminderCheck(env); break;           // 08:00 IST daily
    case '0 13 * * *': await dailyPost(env); break;               // 18:30 IST daily
    case '30 12 * * 0':                                           // Sunday 18:00 IST
      await weeklyLesson(env);
      await reminderCheck(env); // final Sunday evening nag
      break;
  }
}

/* ─────────────────────────── dashboard HTML ─────────────────────────── */

function page(shell) {
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Auto-Reel Factory</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b0d12;color:#e7eaf0;min-height:100vh;display:flex;flex-direction:column}
.wrap{max-width:760px;width:100%;margin:0 auto;padding:28px 20px 60px}
h1{font-size:26px;letter-spacing:-.3px}
h1 .g{background:linear-gradient(90deg,#a78bfa,#34d399);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:#8b93a5;margin:6px 0 26px;font-size:14px;line-height:1.55}
.card{background:#141822;border:1px solid #232a38;border-radius:14px;padding:20px;margin-bottom:16px}
.card h2{font-size:15px;margin-bottom:12px;color:#c3cade}
textarea,input[type=text],input[type=password],input[type=time]{width:100%;background:#0e1118;border:1px solid #2a3245;color:#e7eaf0;border-radius:10px;padding:12px;font-size:14px;font-family:inherit}
textarea{min-height:180px;resize:vertical;line-height:1.5}
button{background:#a78bfa;color:#14121f;font-weight:700;border:0;border-radius:10px;padding:12px 20px;font-size:14px;cursor:pointer;margin-top:12px}
button:hover{filter:brightness(1.08)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{background:#141822;border:1px solid #232a38;border-radius:12px;padding:14px}
.stat .k{font-size:12px;color:#8b93a5}
.stat .v{font-size:20px;font-weight:700;margin-top:4px}
.tag{display:inline-block;font-size:11px;padding:3px 9px;border-radius:20px;margin-right:6px;background:#1d2433;color:#9aa4bb;border:1px solid #2a3245}
.tag.ok{color:#34d399;border-color:#14532d}
.tag.warn{color:#fbbf24;border-color:#78350f}
.tag.bad{color:#f87171;border-color:#7f1d1d}
ul.clean{list-style:none}
ul.clean li{padding:8px 0;border-bottom:1px solid #1c2331;font-size:13px;color:#aab3c7;line-height:1.5}
.foot{margin-top:auto;text-align:center;color:#5b6474;font-size:12px;padding:18px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.err{color:#f87171;font-size:13px;margin-top:10px;display:none}
</style></head><body><div class="wrap">${shell}</div>
<div class="foot">Auto-Reel Factory · free-tier forever · one script a week, seven reels back</div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function dashboardHTML(env) {
  const t = nowIST();
  return page(`
    <h1>🎬 <span class="g">Auto-Reel Factory</span></h1>
    <p class="sub">Week of <b>${t.weekStart}</b> · ${t.date} ${t.time} IST · one script a week, seven reels back.</p>
    <div id="app">Loading…</div>
    <script>
    async function boot(){
      const r = await fetch('/api/status'); if(r.status===401){ location.href='/login'; return; }
      const s = await r.json(); render(s);
    }
    function tag(ok, okT, warnT){ return '<span class="tag '+(ok?'ok':'warn')+'">'+(ok?okT:warnT)+'</span>'; }
    function render(s){
      document.getElementById('app').innerHTML = \`
      <div class="grid">
        <div class="stat"><div class="k">This week's script</div><div class="v">\${s.script_received ? '✅' : '❌'}</div></div>
        <div class="stat"><div class="k">Reels ready</div><div class="v">\${s.reels_rendered}/7</div></div>
        <div class="stat"><div class="k">Posted</div><div class="v">\${s.reels_posted}</div></div>
        <div class="stat"><div class="k">Next post</div><div class="v">\${s.next_post || '—'}</div></div>
      </div>
      <div style="margin:14px 0 22px">
        \${tag(s.ai_configured,'AI: Gemini','AI: Workers AI')}
        \${tag(s.ig_configured,'Instagram: connected','Instagram: token needed')}
        \${tag(s.email_configured,'Reminders: email on','Reminders: no email key')}
      </div>
      <div class="card">
        <h2>📜 This week's script ${s.script_received ? '(received ✓ — editing replaces it)' : ''}</h2>
        <textarea id="script" placeholder="Paste your full weekly script here...">${s.script_text||''}</textarea>
        <button onclick="submitScript()">Send this week's script → factory starts</button>
        <div class="err" id="err"></div>
      </div>
      <div class="card">
        <h2>⚙️ Settings</h2>
        <div class="row">
          <label style="font-size:13px;color:#8b93a5">Daily post time (IST)</label>
          <input type="time" id="postTime" value="\${s.post_time||'18:30'}" style="max-width:140px">
          <label style="font-size:13px;color:#8b93a5">IG @handle</label>
          <input type="text" id="handle" value="\${s.handle||''}" placeholder="@yourhandle" style="max-width:180px">
        </div>
        <button onclick="saveSettings()">Save settings</button>
      </div>
      <div class="card">
        <h2>🧠 What the learner noticed lately</h2>
        <ul class="clean">\${(s.lessons.length?s.lessons:['Nothing yet — lessons appear after your first posts collect stats.']).map(x=>'<li>'+x+'</li>').join('')}</ul>
      </div>
      <div class="card">
        <h2>📅 This week's reels</h2>
        <ul class="clean">\${s.reel_rows.length ? s.reel_rows.map(x=>'<li>Day '+(x.day_index+1)+' · '+x.scheduled_date+' · <b>'+x.status+'</b>'+(x.duration_s?' · '+Math.round(x.duration_s)+'s':'')+'</li>').join('') : '<li>No reels yet — send a script to start the factory.</li>'}</ul>
      </div>\`;
    }
    async function submitScript(){
      const btn=event.target; btn.disabled=true; btn.textContent='Sending…';
      const r = await fetch('/api/script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:document.getElementById('script').value})});
      const d = await r.json(); const e=document.getElementById('err');
      e.style.display='block'; e.style.color = r.ok ? '#34d399' : '#f87171';
      e.textContent = d.message || d.error; if(r.ok) setTimeout(boot,1500); else btn.disabled=false;
    }
    async function saveSettings(){
      const r = await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({post_time:document.getElementById('postTime').value, handle:document.getElementById('handle').value})});
      alert(r.ok?'Saved':'Failed');
    }
    boot();
    </script>`;
}

function loginHTML(msg = '') {
  return page(`
    <h1>🎬 <span class="g">Auto-Reel Factory</span></h1>
    <p class="sub">Enter your passphrase to open the factory floor.</p>
    <div class="card">
      <form method="post" action="/login">
        <input type="password" name="pass" placeholder="Passphrase" required>
        <button type="submit">Unlock</button>
        ${msg ? `<p style="color:#f87171;font-size:13px;margin-top:10px">${msg}</p>` : ''}
        ${msg.includes('not set') ? '<p style="color:#fbbf24;font-size:13px;margin-top:10px">Deployer note: add DASHBOARD_PASSPHRASE as a Worker secret, then reload.</p>' : ''}
      </form>
    </div>`);
}

/* ─────────────────────────── router ─────────────────────────── */

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Public API (GitHub Actions, authenticated by key)
  if (path === '/api/scenes/week' && request.method === 'GET') {
    if (request.headers.get('X-Factory-Key') !== env.WORKER_API_KEY) return json({ error: 'forbidden' }, 403);
    const week = url.searchParams.get('week') || nowIST().weekStart;
    const reels = await env.DB.prepare('SELECT id, day_index, scheduled_date, caption FROM reels WHERE week_start = ? ORDER BY day_index').bind(week).all();
    const out = [];
    for (const r of reels.results) {
      const scenes = await env.DB.prepare('SELECT idx, kind, headline, body, keywords, duration_s, direction FROM scenes WHERE reel_id = ? ORDER BY idx').bind(r.id).all();
      out.push({ reel_id: r.id, day_index: r.day_index, scheduled_date: r.scheduled_date, caption: r.caption,
        scenes: scenes.results.map(s => ({ ...s, keywords: JSON.parse(s.keywords || '[]') })) });
    }
    return json({ week, reels: out, theme: await getSetting(env, 'theme', 'violet'), handle: await getSetting(env, 'handle', '@yourhandle'), ai_label: await getSetting(env, 'ai_label', 'true') });
  }

  if (path === '/api/reels/rendered' && request.method === 'POST') {
    if (request.headers.get('X-Factory-Key') !== env.WORKER_API_KEY) return json({ error: 'forbidden' }, 403);
    const body = await request.json();
    for (const r of (body.reels || [])) {
      await env.DB.prepare("UPDATE reels SET video_path=?, duration_s=?, status='rendered' WHERE id=?")
        .bind(r.video_path, r.duration_s || 60, r.reel_id).run();
    }
    await log(env, 'render', `registered ${body.reels?.length || 0} rendered reels for week ${body.week}`);
    return json({ ok: true });
  }

  // Login/logout
  if (path === '/login' && request.method === 'GET') return loginHTML();
  if (path === '/login' && request.method === 'POST') {
    const form = await request.formData();
    const pass = form.get('pass') || '';
    if (!env.DASHBOARD_PASSPHRASE) return loginHTML('Passphrase not set — add DASHBOARD_PASSPHRASE secret first.');
    if (pass !== env.DASHBOARD_PASSPHRASE) return loginHTML('Wrong passphrase.');
    const token = await hmacHex(env.WORKER_API_KEY || 'rf-dev', 'session:' + env.DASHBOARD_PASSPHRASE);
    return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': `rf_session=${token}; HttpOnly; Secure; Max-Age=2592000; Path=/` } });
  }
  if (path === '/logout') return new Response(null, { status: 302, headers: { Location: '/login', 'Set-Cookie': 'rf_session=; Max-Age=0; Path=/' } });

  // Dashboard + private API
  if (path === '/' && request.method === 'GET') {
    if (!env.DASHBOARD_PASSPHRASE) return loginHTML('Passphrase not set — add DASHBOARD_PASSPHRASE secret first.');
    if (!(await isAuthed(request, env))) return loginHTML();
    return dashboardHTML(env);
  }

  if (path === '/api/status' && request.method === 'GET') {
    if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401);
    const t = nowIST();
    const script = await env.DB.prepare('SELECT content FROM scripts WHERE week_start = ?').bind(t.weekStart).first();
    const counts = await env.DB.prepare(`SELECT
      SUM(CASE WHEN status='rendered' THEN 1 ELSE 0 END) rendered,
      SUM(CASE WHEN status='posted' THEN 1 ELSE 0 END) posted,
      COUNT(*) total FROM reels WHERE week_start = ?`).bind(t.weekStart).first();
    const next = await env.DB.prepare("SELECT scheduled_date FROM reels WHERE status='rendered' AND scheduled_date >= ? ORDER BY scheduled_date LIMIT 1").bind(t.date).first();
    const lessons = await env.DB.prepare('SELECT summary FROM lessons ORDER BY id DESC LIMIT 3').all();
    const reelRows = await env.DB.prepare('SELECT day_index, scheduled_date, status, duration_s FROM reels WHERE week_start = ? ORDER BY day_index').bind(t.weekStart).all();
    return json({
      today: t.date, week: t.weekStart,
      script_received: !!script, script_text: script?.content || '',
      reels_rendered: counts?.rendered || 0, reels_posted: counts?.posted || 0,
      next_post: next?.scheduled_date || null,
      ai_configured: !!env.GEMINI_API_KEY, ig_configured: igReady(env), email_configured: !!env.RESEND_API_KEY,
      post_time: await getSetting(env, 'post_time', env.DEFAULT_POST_TIME_IST || '18:30'),
      handle: await getSetting(env, 'handle', ''),
      lessons: lessons.results.map(l => l.summary.slice(0, 300)),
      reel_rows: reelRows.results,
    });
  }

  if (path === '/api/script' && request.method === 'POST') {
    if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401);
    const { content } = await request.json();
    if (!content || content.trim().length < 40) return json({ error: 'Script looks too short — paste the full weekly script (at least a few sentences).' }, 400);
    const t = nowIST();
    await env.DB.prepare('INSERT INTO scripts (week_start, content, status) VALUES (?,?,?) ON CONFLICT(week_start) DO UPDATE SET content=excluded.content, status=excluded.status')
      .bind(t.weekStart, content.trim(), 'received').run();
    try {
      const { usedAI } = await generateScenes(env, content.trim(), t.weekStart);
      await env.DB.prepare("UPDATE scripts SET status='scenes_generated' WHERE week_start = ?").bind(t.weekStart).run();
      const dispatched = await dispatchRender(env, t.weekStart);
      return json({ ok: true, message: `Script received — scenes written with ${usedAI === 'gemini' ? 'Gemini' : 'Workers AI'}. Factory dispatched: ${dispatched ? 'yes' : 'weekly schedule will pick it up'}. 7 reels incoming!` });
    } catch (e) {
      await env.DB.prepare("UPDATE scripts SET status='failed' WHERE week_start = ?").bind(t.weekStart).run();
      await log(env, 'error', 'scene-gen failed: ' + e.message);
      return json({ error: 'Scene generation failed: ' + e.message + ' — try again; the script is saved.' }, 500);
    }
  }

  if (path === '/api/settings' && request.method === 'POST') {
    if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401);
    const { post_time, handle, ai_label } = await request.json();
    if (post_time) await setSetting(env, 'post_time', post_time);
    if (handle !== undefined) await setSetting(env, 'handle', handle);
    if (ai_label !== undefined) await setSetting(env, 'ai_label', String(ai_label));
    return json({ ok: true });
  }

  if (path === '/api/health') return json({ ok: true, version: env.APP_VERSION || 'dev', time: nowIST() });

  return new Response('Not found', { status: 404 });
}

export default { fetch: handle, scheduled };
