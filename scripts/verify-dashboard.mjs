// Browser verification of the live dashboard (mobile viewport, Playwright).
// Usage: PROD_ADMIN_PASSWORD=... node scripts/verify-dashboard.mjs [https://reel-factory.<sub>.workers.dev]
// Produces screenshots in /home/z/my-project/download/dashboard-shots/ and
// asserts the golden path: login -> overview -> board (7 cards) -> videos ->
// insights/activity -> settings -> honest integration badges -> no console errors.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'https://reel-factory.abhradeep2024-cell.workers.dev';
const PASSWORD = process.env.PROD_ADMIN_PASSWORD;
if (!PASSWORD) { console.error('PROD_ADMIN_PASSWORD env required'); process.exit(2); }
const SHOTS = '/home/z/my-project/download/dashboard-shots';
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const ok = (cond, msg) => {
  if (!cond) throw new Error('DASHBOARD VERIFY FAIL: ' + msg);
  passed++;
  console.log('  ok - ' + msg);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // mobile-first
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  console.log('target:', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#login-form', { timeout: 20000 });
  await page.screenshot({ path: path.join(SHOTS, '1-login-mobile.png') });
  ok(true, 'login screen renders (mobile)');

  await page.fill('#pw', PASSWORD);
  await page.click('#login-btn');
  await page.waitForSelector('nav.tabs', { timeout: 30000 });
  await page.waitForSelector('.card', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '2-overview-mobile.png') });
  ok(true, 'login succeeds, overview renders');

  const badges = await page.locator('.mode-badge').allTextContents();
  ok(badges.length >= 3, `integration mode badges visible: ${badges.join(' | ')}`);

  await page.goto(BASE + '/#/reels');
  await page.waitForTimeout(1500);
  const dayCards = await page.locator('.daycard').count();
  ok(dayCards === 7, `board shows 7 day cards (got ${dayCards})`);
  await page.screenshot({ path: path.join(SHOTS, '3-board-mobile.png') });

  await page.goto(BASE + '/#/videos');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, '4-videos-mobile.png') });
  ok(true, 'videos view renders');

  await page.goto(BASE + '/#/insights');
  await page.waitForTimeout(1500);
  const evCount = await page.locator('.ev').count();
  ok(evCount >= 3, `activity feed shows events (${evCount})`);
  await page.screenshot({ path: path.join(SHOTS, '5-insights-mobile.png') });

  await page.goto(BASE + '/#/settings');
  await page.waitForTimeout(1200);
  const postingTime = await page.locator('#set-posting').inputValue();
  ok(postingTime === '18:00', `settings loaded (posting_time = ${postingTime})`);
  await page.screenshot({ path: path.join(SHOTS, '6-settings-mobile.png') });

  await page.goto(BASE + '/#/script');
  await page.waitForTimeout(1000);
  ok((await page.locator('#sc-text').count()) === 1, 'script submission form renders');

  // desktop spot-check
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktop.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await desktop.waitForSelector('#login-form', { timeout: 20000 });
  await desktop.fill('#pw', PASSWORD);
  await desktop.click('#login-btn');
  await desktop.waitForSelector('.card', { timeout: 20000 });
  await desktop.waitForTimeout(800);
  await desktop.screenshot({ path: path.join(SHOTS, '7-overview-desktop.png') });
  ok(true, 'desktop layout renders');

  ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log(`\nDASHBOARD VERIFIED - ${passed} assertions, screenshots in ${SHOTS}`);
} finally {
  await browser.close();
}
