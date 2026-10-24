// Reel Factory dashboard - router + shell.
import { API, $, esc, toast, modeBadge } from './api.js';
import { renderOverview, renderScript, renderReels, renderVideos, renderInsights, renderSettings } from './views.js';

const ROUTES = {
  '#/': { label: 'Home', render: renderOverview, icon: 'M3 11l9-8 9 8v9a2 2 0 01-2 2h-4v-6h-6v6H5a2 2 0 01-2-2z' },
  '#/script': { label: 'Script', render: renderScript, icon: 'M4 4h16v12H8l-4 4z' },
  '#/reels': { label: 'Reels', render: renderReels, icon: 'M4 5h16v14H4zM9 5v14M4 9h5' },
  '#/videos': { label: 'Videos', render: renderVideos, icon: 'M4 6h10v12H4zM14 10l6-3v10l-6-3' },
  '#/insights': { label: 'Insights', render: renderInsights, icon: 'M4 19V5M4 15l5-5 4 3 6-7' },
  '#/settings': { label: 'Settings', render: renderSettings, icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zM3 12h2m14 0h2M12 3v2m0 14v2' },
};

function icon(d) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`; }

async function boot() {
  let me;
  try { me = await API.get('/api/auth/me'); } catch { me = { authenticated: false }; }
  if (!me.authenticated) return renderLogin();
  window.__status = await API.get('/api/status').catch(() => null);
  drawShell();
  window.addEventListener('hashchange', route);
  route();
}

function renderLogin() {
  $('#app').innerHTML = `
  <div class="login-wrap"><div class="login">
    <div class="hero">
      <div class="logo">${icon('M8 6l10 6-10 6z')}</div>
      <h1>Reel Factory</h1>
      <p>Weekly script in - seven Reels out, automatically.</p>
    </div>
    <form id="login-form">
      <label class="field">Admin password<input id="pw" type="password" autocomplete="current-password" autofocus></label>
      <button class="primary" type="submit" id="login-btn">Unlock dashboard</button>
    </form>
  </div></div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    $('#login-btn').disabled = true;
    try {
      await API.post('/api/auth/login', { password: $('#pw').value });
      location.reload();
    } catch (err) {
      toast(err.message, 'err');
      $('#login-btn').disabled = false;
    }
  };
}

function drawShell() {
  const st = window.__status;
  const badges = st
    ? modeBadge('AI', st.integrations.gemini.mode) + modeBadge('IG', st.integrations.instagram.mode) + modeBadge('mail', st.integrations.email.mode)
    : '';
  $('#app').innerHTML = `
  <header>
    <div class="brand"><span class="logo">${icon('M8 6l10 6-10 6z')}</span>Reel Factory</div>
    <div class="header-right">
      ${badges}
      <button class="ghost" id="logout" style="min-height:34px;padding:4px 12px;font-size:12px">Log out</button>
    </div>
  </header>
  <main id="view"></main>
  <nav class="tabs">
    ${Object.entries(ROUTES).map(([hash, r]) => `<a href="${hash}" data-hash="${hash}">${icon(r.icon)}<span>${r.label}</span></a>`).join('')}
  </nav>`;
  $('#logout').onclick = async () => { await API.post('/api/auth/logout'); location.reload(); };
}

async function route() {
  const hash = location.hash || '#/';
  const r = ROUTES[hash] || ROUTES['#/'];
  document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.hash === (ROUTES[hash] ? hash : '#/')));
  const view = $('#view');
  view.innerHTML = '<div class="center"><div class="spinner"></div></div>';
  try {
    await r.render(view);
  } catch (e) {
    if (e.status === 401) { location.reload(); return; }
    view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
}

boot();
