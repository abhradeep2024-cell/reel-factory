import { Env } from './types';

// ── Dashboard UI (single page, zero dependencies) ──
export function dashboardHtml(env: Env): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reel Factory — Dashboard</title>
<style>
  :root { --bg:#0F1420; --card:#171E2E; --line:#232C42; --text:#E7ECF5; --sub:#8B96AC; --accent:#7C9AFF; --ok:#4ADE80; --warn:#FBBF24; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }
  .wrap { max-width:760px; margin:0 auto; padding:32px 20px 80px; }
  h1 { font-size:26px; letter-spacing:-.3px; } h1 span { color:var(--accent); }
  .sub { color:var(--sub); font-size:14px; margin:6px 0 28px; line-height:1.5; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px; margin-bottom:18px; }
  .card h2 { font-size:15px; font-weight:600; margin-bottom:12px; display:flex; align-items:center; gap:8px; }
  .pill { font-size:11px; font-weight:700; letter-spacing:.5px; padding:3px 9px; border-radius:99px; background:#20293F; color:var(--sub); }
  .pill.ok { color:var(--ok); } .pill.warn { color:var(--warn); }
  textarea { width:100%; min-height:160px; background:#0D1220; border:1px solid var(--line); border-radius:10px; color:var(--text); padding:14px; font-size:14px; line-height:1.6; resize:vertical; }
  textarea:focus { outline:1px solid var(--accent); }
  button { background:var(--text); color:#0D1220; border:none; border-radius:10px; padding:11px 18px; font-size:14px; font-weight:600; cursor:pointer; margin-top:10px; }
  button.ghost { background:#20293F; color:var(--text); }
  button:disabled { opacity:.45; cursor:not-allowed; }
  .row { display:flex; gap:10px; flex-wrap:wrap; }
  .msg { font-size:13px; margin-top:10px; line-height:1.5; }
  .msg.ok { color:var(--ok); } .msg.err { color:#F87171; }
  ul.plain { list-style:none; } ul.plain li { padding:9px 0; border-bottom:1px solid var(--line); font-size:13.5px; line-height:1.5; }
  ul.plain li:last-child { border-bottom:none; }
  .muted { color:var(--sub); font-size:12px; }
  .scene { display:flex; gap:12px; align-items:baseline; padding:8px 0; border-bottom:1px solid var(--line); font-size:13.5px; }
  .scene .n { color:var(--accent); font-weight:700; min-width:22px; }
  .scene .k { margin-left:auto; font-size:11px; color:var(--sub); background:#20293F; padding:2px 8px; border-radius:99px; }
  a { color:var(--accent); }
  .footer { text-align:center; color:var(--sub); font-size:12px; margin-top:30px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🎬 Reel <span>Factory</span></h1>
  <p class="sub">Paste Sunday's script → AI splits it into 6 scenes → rendered into a 60s reel → posted daily at your best time. Week of <b id="week">…</b></p>

  <div class="card">
    <h2>📝 This week's script <span class="pill" id="scriptPill">checking…</span></h2>
    <textarea id="script" placeholder="Paste your weekly script here (min 40 chars)…"></textarea>
    <div class="row">
      <button id="saveBtn" onclick="saveScript()">Save script</button>
      <button class="ghost" id="splitBtn" onclick="split()">✨ Split into scenes</button>
      <button class="ghost" id="renderBtn" onclick="render()">🎞️ Render reel</button>
    </div>
    <div class="msg" id="msg1"></div>
  </div>

  <div class="card">
    <h2>🗂️ Scenes (6 × 10s = 60s)</h2>
    <div id="scenes" class="muted">No scenes yet — split the script first.</div>
  </div>

  <div class="card">
    <h2>📣 Reels this week</h2>
    <ul class="plain" id="reels"><li class="muted">Loading…</li></ul>
  </div>

  <div class="card">
    <h2>🧠 Lessons learned (auto)</h2>
    <ul class="plain" id="lessons"><li class="muted">Will appear after the first posts collect stats.</li></ul>
  </div>

  <div class="card">
    <h2>⏰ Reminder bot <span class="pill" id="remPill">…</span></h2>
    <p class="muted">Checks daily at 08:00 IST. Emails <b>${env.USER_EMAIL}</b> only if the week's script is still missing.</p>
    <ul class="plain" id="reminders"><li class="muted">No reminders yet (that's good news).</li></ul>
  </div>

  <div class="footer">Reel Factory · free stack: Cloudflare Workers + D1 + R2 · GitHub Actions renderer · Gemini · Instagram API</div>
</div>

<script>
const $ = id => document.getElementById(id);
async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}
async function load() {
  try {
    const s = await api('/api/status');
    $('week').textContent = s.week;
    const pill = $('scriptPill');
    if (s.hasScript) { pill.textContent = 'received · ' + s.weekStatus; pill.className = 'pill ok'; }
    else { pill.textContent = 'not received'; pill.className = 'pill warn'; }
    if (s.scenes && s.scenes.length) {
      $('scenes').innerHTML = s.scenes.map(c =>
        '<div class="scene"><span class="n">' + (c.idx+1) + '</span><span>' + esc(c.headline) + '</span><span class="k">' + c.kind + ' · ' + c.duration + 's</span></div>').join('');
    } else { $('scenes').textContent = 'No scenes yet — split the script first.'; }
    if (s.reels && s.reels.length) {
      $('reels').innerHTML = s.reels.map(r =>
        '<li>Day ' + (r.post_day+1) + ' — <b>' + r.render_status + '</b>' +
        (r.video_url ? ' · <a href="' + r.video_url + '">video</a>' : '') +
        (r.posted_at ? ' · ✅ posted ' + r.posted_at : '') + '</li>').join('');
    }
    if (s.lessons && s.lessons.length) {
      $('lessons').innerHTML = s.lessons.map(l => '<li>' + esc(l.body).replace(/\\n/g, '<br>') + '</li>').join('');
    }
    const rp = $('remPill');
    if (s.reminders && s.reminders.length) {
      rp.textContent = s.reminders[0].channel === 'email' ? 'emails sent' : 'dry-run (no email key yet)';
      $('reminders').innerHTML = s.reminders.map(r => '<li>' + r.sent_at + ' UTC · ' + r.channel + '</li>').join('');
    } else { rp.textContent = 'idle'; }
  } catch(e) { $('msg1').className='msg err'; $('msg1').textContent='Load failed: '+e; }
}
function esc(s){ const d=document.createElement('div'); d.textContent=s??''; return d.innerHTML; }
async function saveScript() {
  const btn=$('saveBtn'); btn.disabled=true;
  const r = await api('/api/script', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ script: $('script').value }) });
  show(r); btn.disabled=false; load();
}
async function split() {
  const btn=$('splitBtn'); btn.disabled=true; btn.textContent='Splitting…';
  const r = await api('/api/split', { method:'POST' });
  show(r); btn.disabled=false; btn.textContent='✨ Split into scenes'; load();
}
async function render() {
  const btn=$('renderBtn'); btn.disabled=true; btn.textContent='Dispatching…';
  const r = await api('/api/render', { method:'POST' });
  show(r); btn.disabled=false; btn.textContent='🎞️ Render reel'; load();
}
function show(r){ $('msg1').className='msg '+(r.ok?'ok':'err'); $('msg1').textContent=r.message||r.error||''; }
load(); setInterval(load, 60000);
</script>
</body>
</html>`;
}
