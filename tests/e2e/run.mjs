// End-to-end test against a throwaway local worker instance.
// Boots `wrangler dev` with an isolated D1 state dir, then exercises the full
// weekly loop with the mock planner and dry-run publisher:
//   login -> submit script -> auto-plan 7 reels -> enqueue render -> claim ->
//   upload -> result -> auto-schedule -> publish due (dry-run) -> seed
//   metrics -> insights -> events -> internal cron endpoints.
// The REAL video render path is covered separately by `npm run render:sample`.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 8787;
const BASE = `http://localhost:${PORT}`;
const STATE = path.join(ROOT, '.wrangler', 'e2e-state');

function readDevVars() {
  const out = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.dev.vars'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const VARS = readDevVars();
const KEY = VARS.INTERNAL_API_KEY;
const PW = VARS.ADMIN_PASSWORD;

let cookie = '';
async function call(method, p, body, extraHeaders = {}, expectFail = false) {
  const headers = { ...extraHeaders };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = {};
  try { data = await res.json(); } catch { /* non-json */ }
  if (!expectFail && res.status >= 400) {
    throw new Error(`${method} ${p} -> HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { status: res.status, data };
}

let passed = 0;
function ok(cond, label) {
  if (!cond) throw new Error('E2E FAIL: ' + label);
  passed++;
  console.log(`  ok - ${label}`);
}

async function waitForHealth(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error('wrangler dev did not become healthy in time');
}

async function main() {
  if (!KEY || !PW) throw new Error('.dev.vars must define INTERNAL_API_KEY and ADMIN_PASSWORD (copy .dev.vars.example)');

  console.log('1. boot isolated worker (port 8787, own D1 state)');
  fs.rmSync(STATE, { recursive: true, force: true });
  await run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', STATE], { cwd: ROOT });
  const proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--persist-to', STATE], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  const logs = [];
  proc.stdout.on('data', (d) => logs.push(String(d)));
  proc.stderr.on('data', (d) => logs.push(String(d)));
  try {
    const health = await waitForHealth();
    ok(health.ok === true, `health endpoint ok (d1: ${health.bindings.d1})`);

    console.log('2. auth');
    const anon = await call('GET', '/api/status', undefined, {}, true);
    ok(anon.status === 401, 'status without session -> 401');
    const bad = await call('POST', '/api/auth/login', { password: 'wrong' }, {}, true);
    ok(bad.status === 401, 'wrong password -> 401');
    const login = await call('POST', '/api/auth/login', { password: PW });
    ok(login.data.ok === true, 'correct password -> session cookie');
    const authed = await call('GET', '/api/status');
    ok(authed.data.week && authed.data.integrations, 'status with session -> 200 + shape');
    ok(authed.data.integrations.gemini.mode === 'mock', 'gemini honestly reported as mock');
    ok(authed.data.integrations.instagram.mode === 'dry_run', 'instagram honestly reported as dry_run');

    console.log('3. script intake + planning (mock planner)');
    const script = `Small habits compound into big changes. Your brain automates whatever you repeat. Start with two minutes a day. Attach the new habit to an existing routine. Track it on paper and never miss twice. Consistency beats intensity every single time. In ninety days the habit runs on autopilot.`;
    const sub = await call('POST', '/api/scripts', { script, title: 'E2E habits week' });
    ok(sub.status === 201 && sub.data.week_start, `script accepted for week ${sub.data.week_start}`);
    let planned = false;
    for (let i = 0; i < 20; i++) {
      const s = await call('GET', `/api/scripts/${sub.data.id}`);
      if (s.data.script.status === 'planned') { planned = true; break; }
      if (s.data.script.status === 'planning_failed') throw new Error('planning failed: ' + s.data.script.analysis);
      await sleep(500);
    }
    ok(planned, 'script auto-planned');
    const reels = await call('GET', '/api/reels');
    ok(reels.data.reels.length === 7, '7 reels created');
    ok(reels.data.reels.every((r) => r.duration_sec >= 56 && r.duration_sec <= 64), 'all reels target ~60s');
    ok(new Set(reels.data.reels.map((r) => r.hook_style)).size === 7, '7 distinct hook styles');
    const day0 = reels.data.reels.find((r) => r.day_index === 0);

    console.log('4. render queue protocol (internal API)');
    const enq = await call('POST', `/api/reels/${day0.id}/render`);
    ok(!!enq.data.job_id, 'render job queued');
    const dupe = await call('POST', `/api/reels/${day0.id}/render`, undefined, {}, true);
    ok(dupe.status === 409, 'duplicate enqueue rejected');
    const noKey = await fetch(`${BASE}/internal/render/claim`, { method: 'POST' });
    ok(noKey.status === 401, 'internal API without key -> 401');
    const claim = await call('POST', '/internal/render/claim', { runner: 'e2e' }, { 'X-Internal-Key': KEY });
    ok(claim.data.job && claim.data.job.job_id === enq.data.job_id, 'job claimed');
    ok(claim.data.job.plan.scenes.length >= 5, 'claim includes shot sheet');
    ok(claim.data.job.render.width === 1080 && claim.data.job.render.height === 1920, 'render config is 1080x1920');

    // produce a tiny real MP4 via ffmpeg (validates upload path; full render covered by render:sample)
    const tmp = path.join(ROOT, 'out', 'e2e-fake.mp4');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0x223355:s=1080x1920:d=2:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', '2', tmp]);
    const buf = fs.readFileSync(tmp);
    const up = await fetch(`${BASE}/internal/render/upload?job_id=${enq.data.job_id}&kind=mp4`, {
      method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'X-Internal-Key': KEY }, body: buf,
    });
    const upData = await up.json();
    ok(up.status === 200, 'upload accepted');
    ok(upData.storage === 'none' && upData.url === null, 'no R2 in dev -> honestly reports storage none');
    const result = await call('POST', '/internal/render/result', {
      job_id: enq.data.job_id, status: 'succeeded',
      meta: { bytes: buf.length, duration_sec: 2, width: 1080, height: 1920, fps: 30, storage: 'none' },
    }, { 'X-Internal-Key': KEY });
    ok(result.data.ok === true, 'result accepted');
    const after = await call('GET', '/api/reels');
    const day0after = after.data.reels.find((r) => r.id === day0.id);
    ok(day0after.status === 'scheduled', 'reel auto-scheduled after render (auto-approve on)');
    ok(!!day0after.publish.scheduled_for, 'publication time set');

    console.log('5. publishing (dry-run, no Instagram configured)');
    const resched = await call('POST', `/api/reels/${day0.id}/publish`, { action: 'schedule', scheduled_at: new Date(Date.now() - 60000).toISOString() });
    ok(resched.data.ok === true, 're-scheduled into the past to trigger publish');
    const due = await call('POST', '/api/publish/due');
    ok(due.data.dryRun === 1 || due.data.dry_run === 1, `publish-due produced exactly one dry-run (got ${JSON.stringify(due.data)})`);
    const final = await call('GET', '/api/reels');
    const day0final = final.data.reels.find((r) => r.id === day0.id);
    ok(day0final.status === 'dry_run', 'reel marked dry_run - nothing was posted to Instagram');
    const again = await call('POST', '/api/publish/due');
    ok((again.data.dryRun ?? again.data.dry_run) === 0, 'duplicate publish prevented');

    console.log('6. metrics + insights (honest data handling)');
    const seed = await call('POST', '/internal/dev/seed-metrics', { week: reels.data.week }, { 'X-Internal-Key': KEY });
    ok(seed.data.seeded >= 1, 'synthetic metrics seeded (marked as synthetic)');
    const sync = await call('POST', '/api/metrics/sync');
    ok(sync.data.updated === 0, 'real sync skips - Instagram not configured');
    const ins = await call('POST', '/api/insights/generate');
    ok(ins.data.ok === true && ins.data.model === 'heuristic', `insights generated (${ins.data.model})`);
    ok(ins.data.enough === false, 'insights honestly report insufficient data with a single measured reel');

    console.log('7. events + cron handlers');
    const ev = await call('GET', '/api/events?limit=50');
    const sources = new Set(ev.data.events.map((e) => e.source));
    ok(['planner', 'render', 'publisher'].every((s) => sources.has(s)), 'planner/render/publisher events logged');
    const rem = await call('POST', '/internal/cron/reminder', {}, { 'X-Internal-Key': KEY });
    ok(rem.data.sent === false && rem.data.reason.includes('already submitted'), 'reminder cron: no email when script exists');
    const hourly = await call('POST', '/internal/cron/hourly', {}, { 'X-Internal-Key': KEY });
    ok(typeof hourly.data.publish === 'object', 'hourly cron ran (publish/metrics/recovery)');
    const weekly = await call('POST', '/internal/cron/weekly', {}, { 'X-Internal-Key': KEY });
    ok(typeof weekly.data.planned === 'boolean', 'weekly cron ran');

    console.log(`\nE2E PASSED - ${passed} assertions`);
  } finally {
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already gone */ }
    setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } }, 3000);
    if (logs.length) fs.writeFileSync(path.join(ROOT, 'out', 'e2e-wrangler.log'), logs.join(''));
  }
}

main().catch((e) => { console.error('\n' + e.message); process.exit(1); });
