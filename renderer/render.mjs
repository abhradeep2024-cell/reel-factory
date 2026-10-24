// ── Reel renderer: HTML animation frames -> ffmpeg -> 60s mp4 ──
// Usage: node render.mjs --payload payload.json
// payload: { weekId, reelId, scenes:[{idx,kind,duration,headline,lines,caption,accent}], callbackUrl }
// Secrets via env: RENDER_SECRET
import puppeteer from 'puppeteer';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const FPS = 30;
const W = 1080, H = 1920;
const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url))); // repo root
const outDir = path.join(root, 'renderer', 'out');
const framesDir = path.join(root, 'renderer', 'frames');
const template = fs.readFileSync(path.join(root, 'renderer', 'templates', 'reel-template.html'), 'utf8');

// ── parse args ──
const argi = process.argv.indexOf('--payload');
const payloadPath = argi > -1 ? path.resolve(process.argv[argi + 1]) : path.join(root, 'payload.json');
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const { reelId, callbackUrl, scenes = [] } = payload;
if (!scenes.length) { console.error('no scenes in payload'); process.exit(1); }
if (!reelId) { console.error('no reelId in payload'); process.exit(1); }

fs.rmSync(outDir, { recursive: true, force: true });
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(framesDir, { recursive: true });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed with ${r.status}`);
}

async function renderScene(browser, scene) {
  const html = template.replace('/*__SCENE_DATA__*/', JSON.stringify(scene));
  const file = path.join(framesDir, `scene_${scene.idx}.html`);
  fs.writeFileSync(file, html);

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto('file://' + file, { waitUntil: 'load' });
  await page.evaluate(s => { window.__SCENE__ = s; window.seek(0); }, scene);

  const total = Math.round((scene.duration || 10) * FPS);
  for (let f = 0; f < total; f++) {
    const t = f / FPS;
    await page.evaluate(tt => window.seek(tt), t);
    await page.screenshot({ path: path.join(framesDir, `s${scene.idx}_f${String(f).padStart(5, '0')}.png`) });
  }
  await page.close();

  // frames -> scene mp4
  const sceneMp4 = path.join(outDir, `scene_${scene.idx}.mp4`);
  run('ffmpeg', ['-y', '-framerate', String(FPS),
    '-i', path.join(framesDir, `s${scene.idx}_f%05d.png`),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-vf', `scale=${W}:${H}`, sceneMp4]);
  console.log(`scene ${scene.idx} done (${total} frames)`);
  fs.rmSync(path.join(framesDir), { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  return sceneMp4;
}

(async () => {
  console.log(`rendering reel ${reelId} — ${scenes.length} scenes @${FPS}fps`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const parts = [];
  for (const s of scenes) parts.push(await renderScene(browser, s));
  await browser.close();

  // concat all scenes -> final reel
  const list = path.join(outDir, 'list.txt');
  fs.writeFileSync(list, parts.map(p => `file '${p}'`).join('\n'));
  const reel = path.join(outDir, 'reel.mp4');
  run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', reel]);
  const sizeMB = (fs.statSync(reel).size / 1048576).toFixed(1);
  console.log(`✅ reel.mp4 ready (${sizeMB} MB)`);

  // POST back to worker
  if (callbackUrl) {
    const secret = process.env.RENDER_SECRET;
    if (!secret) console.error('RENDER_SECRET missing — skipping upload');
    else {
      const form = new FormData();
      form.append('reelId', String(reelId));
      form.append('file', new Blob([fs.readFileSync(reel)], { type: 'video/mp4' }), 'reel.mp4');
      const res = await fetch(callbackUrl, { method: 'POST', headers: { 'X-Render-Secret': secret }, body: form });
      console.log('upload ->', res.status, (await res.text()).slice(0, 200));
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
