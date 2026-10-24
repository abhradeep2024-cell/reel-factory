// Deterministic frame capture: Chromium seeks each frame, screenshots to JPEG.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

export async function captureFilm(opts) {
  const {
    htmlPath, outDir, fps = 30, width = 1080, height = 1920,
    durationMs, thumbAtMs = 900, onProgress,
  } = opts;
  const framesDir = path.join(outDir, 'frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text', '--force-device-scale-factor=1'],
  });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
    await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__film && window.__film.ready === true', null, { timeout: 45000 })
      .catch(() => { throw new Error('film never became ready; page errors: ' + (pageErrors.join(' | ') || 'none')); });
    const filmDuration = durationMs || await page.evaluate('window.__film.durationMs');
    const frames = Math.max(1, Math.round((filmDuration / 1000) * fps));
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      const t = (i * 1000) / fps;
      await page.evaluate((tt) => window.__film.seek(tt), t);
      const p = path.join(framesDir, 'f_' + String(i).padStart(6, '0') + '.jpg');
      await page.screenshot({ path: p, type: 'jpeg', quality: 90 });
      if (onProgress) onProgress(i + 1, frames, Date.now() - t0);
      else if (i % 150 === 0) {
        console.log(`  frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
      }
    }
    const thumbIdx = Math.min(frames - 1, Math.round((thumbAtMs / 1000) * fps));
    fs.copyFileSync(
      path.join(framesDir, 'f_' + String(thumbIdx).padStart(6, '0') + '.jpg'),
      path.join(outDir, 'thumb.jpg'),
    );
    return { frames, fps, width, height, durationSec: Math.round((frames / fps) * 100) / 100 };
  } finally {
    await browser.close();
  }
}
