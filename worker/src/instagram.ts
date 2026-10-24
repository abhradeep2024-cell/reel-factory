import { Env } from './types';

// ── Instagram Graph API (v21) : Reels posting + insights ──
// All functions are no-ops when IG secrets are absent (dry-run mode).
const GRAPH = 'https://graph.facebook.com/v21.0';

function igReady(env: Env): boolean {
  return !!(env.IG_USER_ID && env.IG_ACCESS_TOKEN);
}

async function gfetch(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Graph ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

// Step 1+2: create media container from a PUBLIC video URL, poll until ready, publish.
export async function postReel(env: Env, videoUrl: string, caption: string): Promise<string | null> {
  if (!igReady(env)) {
    console.log('[ig] dry-run: would post reel', videoUrl);
    return null;
  }
  const init = await gfetch(`${GRAPH}/${env.IG_USER_ID}/media`, {
    method: 'POST',
    body: new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      access_token: env.IG_ACCESS_TOKEN!,
    }),
  });
  const containerId = init.id as string;

  // poll container until finished (usually < 1 min for 60s reels)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await gfetch(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${env.IG_ACCESS_TOKEN}`
    );
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR') throw new Error('IG container failed');
  }
  const pub = await gfetch(`${GRAPH}/${env.IG_USER_ID}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: containerId, access_token: env.IG_ACCESS_TOKEN! }),
  });
  return pub.id as string;
}

// Insights for one media (reels metrics)
export async function getInsights(env: Env, mediaId: string): Promise<Record<string, number> | null> {
  if (!igReady(env)) return null;
  try {
    const d = await gfetch(
      `${GRAPH}/${mediaId}/insights?metric=plays,reach,likes,comments,saves,saved&access_token=${env.IG_ACCESS_TOKEN}`
    );
    const out: Record<string, number> = {};
    for (const m of d.data ?? []) out[m.name] = Number(m.values?.[0]?.value ?? 0);
    return out;
  } catch (e) {
    console.log('[ig] insights error', String(e).slice(0, 200));
    return null;
  }
}

// Reminders — Resend (free 100/day). No-op without key; logged to DB instead.
export async function sendReminderEmail(env: Env, subject: string, html: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log('[email] dry-run reminder:', subject);
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Reel Factory <onboarding@resend.dev>',
      to: [env.USER_EMAIL],
      subject,
      html,
    }),
  });
  return res.ok;
}
