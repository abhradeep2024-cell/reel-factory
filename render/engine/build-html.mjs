// Build a self-contained HTML film from a shot sheet plan.
// Embeds the Carlito fonts (SIL OFL licensed, vendored in this repo) as
// base64 so renders are pixel-identical on any machine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFilm } from './film.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, 'fonts');

let fontCSSCache = null;
export function fontCSS() {
  if (fontCSSCache !== null) return fontCSSCache;
  let css = '';
  try {
    const regular = fs.readFileSync(path.join(FONTS_DIR, 'Carlito-Regular.ttf')).toString('base64');
    const bold = fs.readFileSync(path.join(FONTS_DIR, 'Carlito-Bold.ttf')).toString('base64');
    css = `@font-face{font-family:'Carlito';src:url(data:font/ttf;base64,${regular}) format('truetype');font-weight:400;font-style:normal;}`;
    css += `@font-face{font-family:'Carlito';src:url(data:font/ttf;base64,${bold}) format('truetype');font-weight:700;font-style:normal;}`;
    css += `@font-face{font-family:'Carlito';src:url(data:font/ttf;base64,${bold}) format('truetype');font-weight:800;font-style:normal;}`;
  } catch (e) {
    console.warn('[build-html] fonts not found, falling back to system fonts:', e.message);
  }
  fontCSSCache = css;
  return css;
}

export function buildFilmHTML(plan, opts = {}) {
  return buildFilm(plan, { ...opts, fontCSS: fontCSS() });
}

// CLI: node render/engine/build-html.mjs --plan plan.json --out film.html
if (process.argv[1] && process.argv[1].endsWith('build-html.mjs')) {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.indexOf('--' + k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const planPath = get('plan');
  const out = get('out') || 'film.html';
  if (!planPath) {
    console.error('usage: build-html.mjs --plan <plan.json> [--out film.html]');
    process.exit(2);
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const { html, durationMs } = buildFilmHTML(plan, { dayIndex: Number(get('day') || 0) });
  fs.writeFileSync(out, html);
  console.log(`wrote ${out} (${(html.length / 1024 / 1024).toFixed(2)} MB, ${(durationMs / 1000).toFixed(1)}s)`);
}
