// Dashboard views: overview, script, reels board, videos, insights, settings.
import { API, $, $$, esc, toast, fmtDT, fmtDate, fmtAgo, fmtNum, fmtBytes, DAY_NAMES, statusPill, modeBadge } from './api.js';

// --------------------------------------------------------------- helpers ---
async function getStatus() {
  window.__status = await API.get('/api/status');
  return window.__status;
}
function barChart(items, { value, label, max }) {
  const m = max ?? Math.max(...items.map(value), 1);
  const rows = items.map((it, i) => {
    const v = value(it) || 0;
    const h = Math.round((v / m) * 100);
    return `<div style="display:flex;align-items:center;gap:8px;margin:7px 0">
      <div style="width:34px;font-size:11px;color:var(--sub)">${esc(label(it))}</div>
      <div class="bar" style="flex:1"><i style="width:${h}%"></i></div>
      <div style="width:64px;text-align:right;font-size:12px">${esc(typeof v === 'number' ? v.toLocaleString() : v)}</div>
    </div>`;
  }).join('');
  return `<div>${rows}</div>`;
}
function integrationsGrid(st) {
  const i = st.integrations;
  const cell = (name, configured, mode, hint) => `
    <div class="card" style="padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <strong>${name}</strong>
        <span class="pill ${configured ? 'ok' : 'warn'}">${configured ? 'connected' : 'not set'}</span>
      </div>
      <div class="muted small">${esc(hint)}</div>
    </div>`;
  return `<div class="grid two">
    ${cell('Gemini AI', i.gemini.configured, i.gemini.mode, i.gemini.configured ? `live planning (${i.gemini.model})` : 'deterministic mock planner is active - add GEMINI_API_KEY for AI planning')}
    ${cell('Instagram', i.instagram.configured, i.instagram.mode, i.instagram.configured ? 'live publishing enabled' : 'dry-run mode - publishing is simulated, nothing is posted')}
    ${cell('Email reminders', i.email.mode === 'live', i.email.mode, i.email.mode === 'live' ? `provider: ${i.email.provider}` : 'log-only - configure Resend or Brevo to receive real emails')}
    ${cell('Video storage (R2)', i.r2_media.enabled, i.r2_media.enabled ? 'live' : 'none', i.r2_media.enabled ? 'rendered MP4s stored in R2' : 'R2 not enabled - rendered files stay on the runner as artifacts')}
  </div>`;
}

// -------------------------------------------------------------- overview ---
export async function renderOverview(view) {
  const st = await getStatus();
  const week = st.week;
  const reels = week.reels_by_status || {};
  const total = Object.values(reels).reduce((a, b) => a + b, 0);
  view.innerHTML = `
  <section class="view">
    <div class="grid stat">
      <div class="card stat"><div class="n">${week.script ? esc(week.script.status) : 'missing'}</div><div class="l">Script for week ${esc(week.target_week_start)}</div></div>
      <div class="card stat"><div class="n">${total}/7</div><div class="l">Reels planned</div></div>
      <div class="card stat"><div class="n">${st.integrations.render_runner.pending_jobs}</div><div class="l">Render jobs pending</div></div>
      <div class="card stat"><div class="n">${st.next_publication ? fmtDT(st.next_publication.scheduled_for) : '—'}</div><div class="l">Next publication</div></div>
    </div>
    <div class="card">
      <h2>This week ${week.script ? '' : '<span class="pill warn" style="float:right">script missing</span>'}</h2>
      ${week.script
        ? `<p class="muted">Submitted ${fmtAgo(week.script.submitted_at)} - status: <strong>${esc(week.script.status)}</strong></p>`
        : `<p class="muted">No script submitted for the week of <strong>${esc(week.target_week_start)}</strong> yet. The daily 08:00 reminder is active until you submit one.</p>
           <div class="btn-row" style="margin-top:12px"><button class="primary" onclick="location.hash='#/script'">Submit weekly script</button></div>`}
    </div>
    <div class="card">
      <h2>Integrations</h2>
      <p class="muted small" style="margin-bottom:10px">The dashboard never fakes connection states - it shows exactly what is configured.</p>
      ${integrationsGrid(st)}
    </div>
    <div class="card">
      <h2>Quick actions</h2>
      <div class="btn-row">
        <button class="primary" onclick="location.hash='#/script'">Submit script</button>
        <button onclick="location.hash='#/reels'">This week's reels</button>
        <button onclick="location.hash='#/videos'">Watch renders</button>
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- script ---
export async function renderScript(view) {
  const [scripts, st] = await Promise.all([API.get('/api/scripts'), getStatus()]);
  view.innerHTML = `
  <section class="view">
    <div class="card">
      <h2>Submit weekly script</h2>
      <p class="muted small" style="margin-bottom:12px">Paste this week's script (min 120 characters). It covers the week starting <strong>${esc(st.week.target_week_start)}</strong>. Planning starts immediately.</p>
      <div style="display:flex;flex-direction:column;gap:12px">
        <label class="field">Title (optional)<input id="sc-title" placeholder="e.g. Habits week" maxlength="120"></label>
        <label class="field">Script<textarea id="sc-text" placeholder="Paste the full weekly script here..."></textarea></label>
        <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--sub)"><input type="checkbox" id="sc-auto" checked style="width:auto"> Plan 7 reels automatically after submitting</label>
        <div class="btn-row"><button class="primary" id="sc-submit">Submit & plan</button></div>
      </div>
    </div>
    <div class="card">
      <h2>History</h2>
      <div id="sc-list">${scripts.scripts.length ? scripts.scripts.map((s) => `
        <div class="row">
          <div class="grow">
            <strong>Week ${esc(s.week_start)}</strong> ${s.title ? `<span class="muted">- ${esc(s.title)}</span>` : ''}<br>
            <span class="muted small">${s.reel_count} reels - submitted ${fmtAgo(s.submitted_at)}</span>
          </div>
          <div>
            <span class="pill ${s.status === 'planned' ? 'ok' : s.status === 'planning_failed' ? 'err' : 'info'}">${esc(s.status)}</span>
            <div class="btn-row" style="margin-top:6px">
              <button class="ghost small-btn" data-plan="${esc(s.id)}" data-status="${esc(s.status)}" style="min-height:32px;padding:4px 10px;font-size:12px">${s.status === 'planned' ? 'Replan' : 'Plan'}</button>
              <button class="danger ghost small-btn" data-del="${esc(s.id)}" style="min-height:32px;padding:4px 10px;font-size:12px">Delete</button>
            </div>
          </div>
        </div>`).join('') : '<p class="muted">No scripts yet.</p>'}
      </div>
    </div>
  </section>`;
  $('#sc-submit').onclick = async () => {
    const script = $('#sc-text').value.trim();
    if (script.length < 120) return toast('Script too short (min 120 characters)', 'err');
    $('#sc-submit').disabled = true;
    try {
      const r = await API.post('/api/scripts', { script, title: $('#sc-title').value.trim(), auto_plan: $('#sc-auto').checked });
      toast(`Script submitted for week ${r.week_start}. Planning started.`, 'ok');
      renderScript(view);
    } catch (e) { toast(e.message, 'err'); $('#sc-submit').disabled = false; }
  };
  $$('#sc-list [data-plan]').forEach((b) => {
    b.onclick = async () => {
      try {
        await API.post(`/api/scripts/${b.dataset.plan}/plan`, b.dataset.status === 'planned' ? { force: true } : {});
        toast('Planning started - watch the board', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
  });
  $$('#sc-list [data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Delete this script and all its reels?')) return;
      try { await API.del(`/api/scripts/${b.dataset.del}`); toast('Deleted', 'ok'); renderScript(view); }
      catch (e) { toast(e.message, 'err'); }
    };
  });
}

// ----------------------------------------------------------------- reels ---
export async function renderReels(view, weekOffset = 0) {
  const st = await getStatus();
  let week = st.week.target_week_start;
  if (weekOffset) {
    const d = new Date(week + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + weekOffset * 7);
    week = d.toISOString().slice(0, 10);
  }
  const data = await API.get(`/api/reels?week=${week}`).catch(() => ({ reels: [] }));
  const schedule = await API.get('/api/schedule');
  const upcoming = (schedule.schedule || []).filter((s) => ['scheduled', 'publishing'].includes(s.status)).slice(0, 8);
  view.innerHTML = `
  <section class="view">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <button class="ghost" id="wk-prev" style="min-height:36px">←</button>
        <h2 style="margin:0">Week of ${esc(week)}</h2>
        <button class="ghost" id="wk-next" style="min-height:36px">→</button>
      </div>
      <div class="board">
        ${data.reels.length ? data.reels.map((r) => `
        <div class="card daycard">
          <div class="daynum"><div class="dn">${r.day_index + 1}</div><div class="dl">${DAY_NAMES[r.day_index]}</div></div>
          <div class="body">
            <div class="t">${esc(r.title)}</div>
            <div class="meta">
              ${statusPill(r.status)}
              <span class="pill">${esc(r.template)}</span>
              ${r.duration_sec ? `<span class="pill">${r.duration_sec}s</span>` : ''}
              ${r.publish.status ? `<span class="pill ${r.publish.status === 'published' ? 'ok' : r.publish.status === 'dry_run' ? 'warn' : r.publish.status === 'failed' ? 'err' : ''}">pub: ${esc(r.publish.status)}</span>` : ''}
            </div>
            <div class="muted small" style="margin-top:4px">${r.publish.scheduled_for ? 'scheduled ' + fmtDT(r.publish.scheduled_for) : r.publish.published_at ? 'published ' + fmtAgo(r.publish.published_at) : 'not scheduled'}</div>
          </div>
          <div class="btn-row" style="flex-direction:column">
            ${['planned', 'render_failed', 'rendered'].includes(r.status) ? `<button data-render="${esc(r.id)}" style="min-height:36px;font-size:12px">Render</button>` : ''}
            ${r.status === 'rendered' ? `<button data-sched="${esc(r.id)}" style="min-height:36px;font-size:12px">Schedule</button>` : ''}
            ${['rendered', 'scheduled', 'publish_failed'].includes(r.status) ? `<button class="primary" data-now="${esc(r.id)}" style="min-height:36px;font-size:12px">${window.__status?.integrations.instagram.configured ? 'Publish' : 'Dry-run'}</button>` : ''}
            ${['scheduled'].includes(r.status) ? `<button class="danger ghost" data-cancel="${esc(r.id)}" style="min-height:36px;font-size:12px">Cancel</button>` : ''}
          </div>
        </div>`).join('') : '<p class="muted">No reels for this week. Submit a script first.</p>'}
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button id="render-all">Render all (queue)</button>
      </div>
    </div>
    <div class="card">
      <h2>Upcoming publications</h2>
      ${upcoming.length ? upcoming.map((s) => `
        <div class="row"><div class="grow"><strong>${esc(s.title)}</strong><br><span class="muted small">${fmtDT(s.scheduled_for)} - ${esc(s.week_start)} day ${s.day_index + 1}</span></div>${statusPill(s.reel_status)}</div>`).join('')
      : '<p class="muted">Nothing scheduled yet.</p>'}
    </div>
  </section>`;
  $('#wk-prev').onclick = () => renderReels(view, weekOffset - 1);
  $('#wk-next').onclick = () => renderReels(view, weekOffset + 1);
  const bind = (sel, fn) => $$(sel, view).forEach((b) => { b.onclick = () => fn(b.dataset[sel.match(/data-(\w+)/)[1]]); });
  bind('[data-render]', async (id) => { try { await API.post(`/api/reels/${id}/render`); toast('Render job queued - the GitHub Actions runner picks it up within ~15 minutes', 'ok'); setTimeout(() => renderReels(view, weekOffset), 800); } catch (e) { toast(e.message, 'err'); } });
  bind('[data-sched]', async (id) => { try { await API.post(`/api/reels/${id}/publish`, { action: 'schedule' }); toast('Scheduled', 'ok'); renderReels(view, weekOffset); } catch (e) { toast(e.message, 'err'); } });
  bind('[data-now]', async (id) => { try { const r = await API.post(`/api/reels/${id}/publish`, { action: 'now' }); toast(r.result === 'dry_run' ? 'Dry-run complete (Instagram not configured - nothing was posted)' : `Result: ${r.result}`, r.result === 'failed' ? 'err' : 'ok'); renderReels(view, weekOffset); } catch (e) { toast(e.message, 'err'); } });
  bind('[data-cancel]', async (id) => { try { await API.post(`/api/reels/${id}/publish`, { action: 'cancel' }); toast('Cancelled', 'ok'); renderReels(view, weekOffset); } catch (e) { toast(e.message, 'err'); } });
  $('#render-all').onclick = async () => {
    try { const r = await API.post('/api/reels/render-all', { week }); toast(`${r.queued} render job(s) queued`, 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------- videos ---
export async function renderVideos(view) {
  const st = await getStatus();
  const data = await API.get(`/api/reels?week=${st.week.target_week_start}`);
  const rendered = data.reels.filter((r) => r.media.mp4_url || r.media.thumb_url);
  view.innerHTML = `
  <section class="view">
    <div class="card">
      <h2>Rendered reels</h2>
      ${rendered.length ? `<div class="videos">${rendered.map((r) => `
        <div class="vidcard">
          ${r.media.mp4_url ? `<video src="${esc(r.media.mp4_url)}" ${r.media.thumb_url ? `poster="${esc(r.media.thumb_url)}"` : ''} controls preload="none" playsinline></video>` : `<img src="${esc(r.media.thumb_url)}" alt="thumbnail">`}
          <div class="vbody">
            <strong>${r.day_index + 1}. ${esc(r.title)}</strong>
            <span class="muted">${r.duration_sec}s - ${fmtBytes(r.media.mp4_bytes)}</span>
            <div class="btn-row">${r.media.mp4_url ? `<a class="btn" style="min-height:34px;font-size:12px;display:inline-flex;align-items:center" href="${esc(r.media.mp4_url)}" download target="_blank" rel="noopener">MP4</a>` : '<span class="pill warn">not stored (R2 off)</span>'}</div>
          </div>
        </div>`).join('')}</div>`
      : '<p class="muted">No rendered videos yet this week. Render reels from the board, or check earlier weeks below.</p>'}
    </div>
    <div class="card">
      <h2>All videos (any week)</h2>
      <div id="all-videos"><div class="center"><div class="spinner"></div></div></div>
    </div>
  </section>`;
  const jobs = await API.get('/api/jobs');
  const done = (jobs.jobs || []).filter((j) => j.status === 'succeeded');
  $('#all-videos', view).innerHTML = done.length
    ? done.slice(0, 12).map((j) => `<div class="row"><div class="grow"><strong>${esc(j.reel_title || j.reel_id)}</strong><br><span class="muted small">${fmtDate(j.finished_at)} - ${j.duration_sec}s - ${fmtBytes(j.mp4_bytes)}</span></div><span class="pill ok">done</span></div>`).join('')
    : '<p class="muted">No completed render jobs yet.</p>';
}

// -------------------------------------------------------------- insights ---
export async function renderInsights(view) {
  const [insights, metrics, events] = await Promise.all([
    API.get('/api/insights'),
    API.get('/api/metrics'),
    API.get('/api/events?limit=25'),
  ]);
  const withMetrics = (metrics.metrics || []).filter((m) => m.views != null);
  const byReel = new Map();
  for (const m of withMetrics) if (!byReel.has(m.reel_id)) byReel.set(m.reel_id, m);
  view.innerHTML = `
  <section class="view">
    <div class="card">
      <h2>Analytics (real API data only)</h2>
      ${byReel.size ? barChart([...byReel.values()], { value: (m) => m.views, label: (m) => 'D' + (m.day_index + 1) }) : '<p class="muted">No Instagram metrics recorded yet. Metrics sync automatically once reels are published with a connected account.</p>'}
      ${byReel.size ? `<h3 style="margin-top:14px">Engagement rate</h3>` + barChart([...byReel.values()], { value: (m) => m.engagement_rate != null ? (m.engagement_rate * 100).toFixed(2) + '%' : 0, label: (m) => 'D' + (m.day_index + 1) }) : ''}
      <div class="btn-row" style="margin-top:12px"><button id="sync-metrics">Sync metrics now</button></div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h2 style="margin:0">Learning loop</h2>
        <button class="primary" id="gen-insights">Generate insights</button>
      </div>
      ${(insights.insights || []).slice(0, 3).map((i) => `
        <div class="muted small" style="margin:10px 0 6px">${fmtAgo(i.created_at)} - ${esc(i.model)} model - based on ${i.based_on_reels} reels (${i.based_on_metrics} with metrics)</div>
        <p style="margin-bottom:12px">${esc(i.summary)}</p>
        ${(i.recommendations || []).slice(0, 6).map((r) => `
          <div class="ins">
            <div class="area">${esc(r.area || 'general')} - confidence: ${esc(r.confidence || 'low')}</div>
            <div class="muted small" style="margin-top:2px">${esc(r.finding || '')}</div>
            <div class="rec">${esc(r.recommendation || '')}</div>
          </div>`).join('')}`).join('') || '<p class="muted">No insights generated yet. Insights are based only on real recorded metrics - generate after a few reels have been published and measured.</p>'}
    </div>
    <div class="card">
      <h2>Activity</h2>
      ${(events.events || []).map((e) => `
        <div class="ev"><div class="lv ${esc(e.level)}"></div>
          <div class="grow"><strong>${esc(e.source)}</strong> - ${esc(e.message)}<div class="t">${fmtDT(e.ts)}</div></div>
        </div>`).join('') || '<p class="muted">No events.</p>'}
    </div>
  </section>`;
  $('#sync-metrics').onclick = async () => { try { const r = await API.post('/api/metrics/sync'); toast(`Synced ${r.updated} reel(s)`, 'ok'); renderInsights(view); } catch (e) { toast(e.message, 'err'); } };
  $('#gen-insights').onclick = async () => { try { const r = await API.post('/api/insights/generate'); toast(`Insights generated (${r.model})`, 'ok'); renderInsights(view); } catch (e) { toast(e.message, 'err'); } };
}

// -------------------------------------------------------------- settings ---
export async function renderSettings(view) {
  const [st, s] = await Promise.all([getStatus(), API.get('/api/settings')]);
  const v = s.settings;
  const F = (id, label, type, val, extra = '') =>
    `<label class="field">${label}<input id="${id}" type="${type}" value="${esc(val)}" ${extra}></label>`;
  view.innerHTML = `
  <section class="view">
    <div class="card">
      <h2>Production settings</h2>
      <div class="grid two">
        ${F('set-posting', 'Daily posting time (local)', 'time', v.posting_time)}
        ${F('set-reminder', 'Reminder check time (local)', 'time', v.reminder_time)}
        <label class="field">Timezone<input id="set-tz" value="${esc(v.timezone)}"></label>
        ${F('set-email', 'Reminder email', 'email', v.reminder_email)}
        ${F('set-retention', 'Retention (days, 7-365)', 'number', v.retention_days, 'min="7" max="365"')}
        ${F('set-gemini', 'Gemini model', 'text', v.gemini_model)}
        ${F('set-origin', 'Public app origin (https://..., for Instagram media URLs)', 'text', v.app_origin, 'placeholder="https://reel-factory.<subdomain>.workers.dev"')}
        <label class="field">Default hashtags (comma separated)<input id="set-tags" value="${esc((JSON.parse(v.default_hashtags || '[]')).join(', '))}"></label>
        ${F('set-suffix', 'Caption suffix', 'text', v.caption_suffix)}
        <label class="field">Auto-approve publishing
          <select id="set-auto"><option value="true" ${v.auto_approve_publish === 'true' ? 'selected' : ''}>Yes - schedule rendered reels automatically</option><option value="false" ${v.auto_approve_publish === 'false' ? 'selected' : ''}>No - I approve each reel</option></select>
        </label>
      </div>
      <div class="btn-row" style="margin-top:14px"><button class="primary" id="set-save">Save settings</button></div>
    </div>
    <div class="card">
      <h2>Integrations & setup</h2>
      ${integrationsGrid(st)}
      <div class="muted small" style="margin-top:12px;line-height:1.7">
        <strong>Setup guide:</strong> full step-by-step instructions for Gemini, Instagram, email and R2 live in
        <code>docs/SETUP.md</code> in the repository. Secrets are set with <code>wrangler secret put NAME</code> - never stored in code.
      </div>
      <div class="btn-row" style="margin-top:10px"><button id="test-email">Send test email</button></div>
    </div>
    <div class="card">
      <h2>Session</h2>
      <div class="btn-row"><button class="danger" id="logout2">Log out</button></div>
    </div>
  </section>`;
  $('#set-save').onclick = async () => {
    try {
      await API.put('/api/settings', {
        posting_time: $('#set-posting').value,
        reminder_time: $('#set-reminder').value,
        timezone: $('#set-tz').value,
        reminder_email: $('#set-email').value,
        retention_days: $('#set-retention').value,
        gemini_model: $('#set-gemini').value,
        app_origin: $('#set-origin').value.trim(),
        caption_suffix: $('#set-suffix').value,
        auto_approve_publish: $('#set-auto').value,
        default_hashtags: $('#set-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      });
      toast('Settings saved', 'ok');
    } catch (e) { toast(e.message + (e.data?.errors ? ' - ' + e.data.errors.join('; ') : ''), 'err'); }
  };
  $('#test-email').onclick = async () => {
    try { const r = await API.post('/api/settings/test-email'); toast(r.ok ? `Test email sent via ${r.provider}` : `Send failed: ${r.detail}`, r.ok ? 'ok' : 'err'); }
    catch (e) { toast(e.message, 'err'); }
  };
  $('#logout2').onclick = async () => { await API.post('/api/auth/logout'); location.reload(); };
}
