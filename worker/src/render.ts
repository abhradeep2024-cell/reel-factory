import { Env, Scene } from './types';

// ── Dispatch render job to GitHub Actions (free renderer) ──
// Worker -> repository_dispatch -> Actions renders 60s mp4 via Puppeteer+FFmpeg
// -> Actions POSTs the mp4 back to our /api/reels/upload endpoint.

export async function dispatchRender(env: Env, weekId: number, reelId: number, scenes: Scene[]): Promise<{ ok: boolean; detail: string }> {
  if (!env.GH_RENDER_TOKEN) return { ok: false, detail: 'GH_RENDER_TOKEN secret not set' };
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_RENDER_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'reel-factory-worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'render-reel',
      client_payload: { weekId, reelId, scenes, callbackUrl: `${env.WORKER_URL}/api/reels/upload` },
    }),
  });
  if (res.status === 204) return { ok: true, detail: 'dispatched' };
  const t = await res.text();
  return { ok: false, detail: `GitHub ${res.status}: ${t.slice(0, 200)}` };
}
