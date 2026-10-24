// API client + shared helpers for the dashboard.
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

async function req(method, path, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const API = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b ?? {}),
  put: (p, b) => req('PUT', p, b ?? {}),
  del: (p) => req('DELETE', p),
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
export function fmtAgo(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
export function fmtBytes(n) {
  if (!n) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  return Math.round(n / 1e3) + ' kB';
}

export function toast(msg, kind = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export const REEL_STATUS = {
  planned: { label: 'Planned', cls: '' },
  queued: { label: 'Queued', cls: 'info' },
  rendering: { label: 'Rendering', cls: 'info' },
  rendered: { label: 'Rendered', cls: 'ok' },
  render_failed: { label: 'Render failed', cls: 'err' },
  scheduled: { label: 'Scheduled', cls: 'ok' },
  publishing: { label: 'Publishing', cls: 'warn' },
  published: { label: 'Published', cls: 'ok' },
  publish_failed: { label: 'Publish failed', cls: 'err' },
  dry_run: { label: 'Dry run', cls: 'warn' },
};
export function statusPill(status) {
  const s = REEL_STATUS[status] || { label: status, cls: '' };
  return `<span class="pill ${s.cls}">${s.label}</span>`;
}
export function modeBadge(name, mode) {
  return `<span class="mode-badge ${mode === 'live' ? 'live' : 'mock'}">${name}: ${mode}</span>`;
}
