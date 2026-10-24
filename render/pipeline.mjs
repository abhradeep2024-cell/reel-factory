#!/usr/bin/env node
// Render pipeline orchestrator.
//
// Modes:
//   --sample [--day N] [--out DIR] [--duration-cap SEC] [--keep-frames]
//       Render the bundled sample script (deterministic mock planner) - used
//       for offline verification and as a visual test.
//   --plan path.json [--out DIR]
//       Render a specific shot sheet JSON file.
//   --job --api URL --key KEY [--max-jobs N]
//       Runner mode used by GitHub Actions: claim jobs from the app, render,
//       upload artifacts, report results, repeat until the queue is empty.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildFilmHTML } from './engine/build-html.mjs';
import { captureFilm } from './capture.mjs';
import { encodeFilm, probeVideo, validateProbe } from './encode.mjs';
import { mockReelPlan } from '../src/shared/mockplanner.mjs';
import { validateReelPlan, normalizeReelPlan } from '../src/shared/shotsheet.mjs';

// ---------------------------------------------------------------- args ----
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function scalePlanDuration(plan, capSec) {
  const total = plan.scenes.reduce((a, s) => a + s.duration_sec, 0);
  if (total <= capSec) return plan;
  const k = capSec / total;
  const scaled = {
    ...plan,
    scenes: plan.scenes.map((s) => ({ ...s, duration_sec: Math.max(1.2, Math.round(s.duration_sec * k * 10) / 10) })),
  };
  scaled.duration_sec = Math.round(scaled.scenes.reduce((a, s) => a + s.duration_sec, 0) * 10) / 10;
  return scaled;
}

// ------------------------------------------------------------- rendering ---
async function renderPlanToMP4(plan, opts) {
  const { outDir, fps = 30, dayIndex = 0, keepFrames = false, relaxed = false } = opts;
  const v = validateReelPlan(plan, relaxed ? { minScenes: 2, minSceneSec: 0.4, minTotalSec: 2, maxTotalSec: 999 } : undefined);
  if (!v.ok) throw new Error('invalid shot sheet: ' + v.errors.slice(0, 5).join('; '));
  const norm = normalizeReelPlan(plan);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`building HTML film: ${norm.template}, ${norm.scenes.length} scenes, ${norm.duration_sec}s`);
  const { html, durationMs } = buildFilmHTML(norm, { fps, dayIndex });
  const htmlPath = path.join(outDir, 'film.html');
  fs.writeFileSync(htmlPath, html);

  console.log(`capturing ${Math.round((durationMs / 1000) * fps)} frames at ${fps}fps...`);
  const cap = await captureFilm({ htmlPath, outDir, fps, width: 1080, height: 1920, durationMs });

  console.log('encoding H.264 (Instagram spec)...');
  const mp4Path = path.join(outDir, 'reel.mp4');
  await encodeFilm({ framesDir: path.join(outDir, 'frames'), outPath: mp4Path, fps });

  const probe = await probeVideo(mp4Path);
  const check = validateProbe(probe, {
    width: 1080, height: 1920, fps,
    minSec: Math.max(3, norm.duration_sec - 2.5),
    maxSec: norm.duration_sec + 3,
  });
  if (!check.ok) throw new Error('render validation failed: ' + check.errors.join('; '));

  const bytes = fs.statSync(mp4Path).size;
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(mp4Path)).digest('hex');
  if (!keepFrames) fs.rmSync(path.join(outDir, 'frames'), { recursive: true, force: true });
  console.log(`validated: ${check.info.duration}s, ${check.info.fps}fps, ${(bytes / 1e6).toFixed(1)}MB`);
  return {
    mp4Path, thumbPath: path.join(outDir, 'thumb.jpg'), htmlPath,
    durationSec: check.info.duration, width: 1080, height: 1920, fps, bytes, sha256,
  };
}

// -------------------------------------------------------------- job mode ---
async function fetchJSON(url, opts = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { _raw: text }; }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return data;
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(3000 * (i + 1));
    }
  }
  throw lastErr;
}

async function uploadRaw(url, filePath, contentType, key) {
  const buf = fs.readFileSync(filePath);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'X-Internal-Key': key, 'Content-Length': String(buf.length) },
    body: buf,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`upload failed HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function runJobMode({ api, key, maxJobs = 10 }) {
  const apiBase = api.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', 'X-Internal-Key': key };
  const health = await fetchJSON(`${apiBase}/api/health`, {}, 0);
  console.log(`runner connected: ${health.app} v${health.version} (d1: ${health.bindings.d1}, r2: ${health.bindings.r2})`);
  let done = 0;
  while (done < maxJobs) {
    const claim = await fetchJSON(`${apiBase}/internal/render/claim`, {
      method: 'POST', headers, body: JSON.stringify({ runner: process.env.RUNNER_NAME || 'github-actions' }),
    });
    const job = claim.job;
    if (!job) { console.log('render queue empty'); break; }
    console.log(`\n=== job ${job.job_id}: "${job.title}" (day ${job.day_index + 1}, ${job.render.target_duration_sec}s target) ===`);
    try {
      const outDir = path.join('out', job.job_id);
      const r = await renderPlanToMP4(job.plan, {
        outDir, fps: job.render.fps || 30, dayIndex: job.day_index,
      });
      const upM = await uploadRaw(`${apiBase}/internal/render/upload?job_id=${job.job_id}&kind=mp4`, r.mp4Path, 'video/mp4', key);
      const upT = await uploadRaw(`${apiBase}/internal/render/upload?job_id=${job.job_id}&kind=thumbnail`, r.thumbPath, 'image/jpeg', key);
      await fetchJSON(`${apiBase}/internal/render/result`, {
        method: 'POST', headers,
        body: JSON.stringify({
          job_id: job.job_id, status: 'succeeded',
          meta: {
            bytes: r.bytes, duration_sec: r.durationSec, width: r.width, height: r.height,
            fps: r.fps, sha256: r.sha256,
            mp4_url: upM.url || null, thumb_url: upT.url || null, storage: upM.storage,
          },
        }),
      });
      console.log(`job ${job.job_id} complete (storage: ${upM.storage}${upM.url ? '' : ' - R2 not configured, kept as artifact'})`);
    } catch (e) {
      console.error(`job ${job.job_id} FAILED: ${e.message}`);
      await fetchJSON(`${apiBase}/internal/render/result`, {
        method: 'POST', headers,
        body: JSON.stringify({ job_id: job.job_id, status: 'failed', error: String(e.message).slice(0, 800) }),
      }).catch(() => {});
    }
    done++;
  }
  return done;
}

// ------------------------------------------------------------------ main ---
async function main() {
  const args = parseArgs();
  if (args.job) {
    if (!args.api || !args.key) {
      console.error('--job mode requires --api URL --key KEY');
      process.exit(2);
    }
    const done = await runJobMode({ api: args.api, key: args.key, maxJobs: Number(args['max-jobs'] || 10) });
    console.log(`\nrunner finished: ${done} job(s)`);
    return;
  }
  if (args.sample || (!args.plan && !args.job)) {
    const day = Number(args.day || 0);
    const cap = args['duration-cap'] ? Number(args['duration-cap']) : null;
    const outDir = args.out || path.join('out', 'sample');
    const script = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'sample-script.txt'), 'utf8');
    let plan = mockReelPlan(script, day);
    if (cap) plan = scalePlanDuration(plan, cap);
    console.log(`sample render: day ${day + 1} "${plan.title}" [${plan.template}]${cap ? ` (duration capped to ${cap}s)` : ''}`);
    const r = await renderPlanToMP4(plan, { outDir, fps: 30, dayIndex: day, keepFrames: !!args['keep-frames'], relaxed: !!cap });
    console.log(`\nsample reel ready:\n  mp4:  ${path.resolve(r.mp4Path)}\n  thumb:${path.resolve(r.thumbPath)}\n  html: ${path.resolve(r.htmlPath)}`);
    return;
  }
  if (args.plan) {
    const plan = JSON.parse(fs.readFileSync(args.plan, 'utf8'));
    const outDir = args.out || path.join('out', 'custom');
    const r = await renderPlanToMP4(plan, { outDir, fps: 30, dayIndex: Number(args.day || 0) });
    console.log(`reel ready: ${path.resolve(r.mp4Path)} (${r.durationSec}s, ${(r.bytes / 1e6).toFixed(1)}MB)`);
    return;
  }
}

main().catch((e) => { console.error('pipeline error:', e); process.exit(1); });
