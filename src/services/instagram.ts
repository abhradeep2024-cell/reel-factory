// Instagram Graph API client (official Content Publishing + Insights).
// DRY-RUN until IG_USER_ID + IG_ACCESS_TOKEN are configured.
import type { Env } from '../lib/env';

export function instagramConfigured(env: Env): boolean {
  return !!(env.IG_USER_ID && env.IG_ACCESS_TOKEN);
}

function graphBase(env: Env): string {
  return `https://graph.facebook.com/${env.IG_GRAPH_VERSION || 'v23.0'}`;
}

async function igFetch(env: Env, path: string, params: Record<string, any>, method = 'GET'): Promise<any> {
  const url = new URL(`${graphBase(env)}${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('access_token', env.IG_ACCESS_TOKEN || '');
  const res = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const msg = data?.error?.message || JSON.stringify(data).slice(0, 200);
    throw new Error(`Instagram API ${res.status}: ${msg} (code ${data?.error?.code ?? '?'}, subcode ${data?.error?.error_subcode ?? '?'})`);
  }
  return data;
}

export async function createReelContainer(env: Env, opts: { videoUrl: string; caption?: string }): Promise<{ id: string }> {
  return igFetch(env, `/${env.IG_USER_ID}/media`, {
    media_type: 'REELS',
    video_url: opts.videoUrl,
    caption: opts.caption || '',
    share_to_feed: 'true',
  }, 'POST');
}

export async function containerStatus(env: Env, containerId: string): Promise<string> {
  const d = await igFetch(env, `/${containerId}`, { fields: 'status_code,status' });
  return d?.status_code || d?.status || 'UNKNOWN';
}

export async function publishContainer(env: Env, containerId: string): Promise<{ id: string }> {
  return igFetch(env, `/${env.IG_USER_ID}/media_publish`, { creation_id: containerId }, 'POST');
}

export async function publishingLimit(env: Env): Promise<number | null> {
  try {
    const d = await igFetch(env, `/${env.IG_USER_ID}/content_publishing_limit`, { fields: 'config,quota_usage' });
    return Number(d?.quota_usage);
  } catch {
    return null;
  }
}

// Metric sets degrade gracefully: accounts expose different metrics depending
// on app review level and account type. We store whatever the API returns.
const METRIC_SETS = [
  ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions'],
  ['views', 'reach', 'likes', 'comments', 'saved', 'shares'],
  ['views', 'likes', 'comments'],
  ['likes', 'comments'],
];

export async function fetchReelInsights(env: Env, igMediaId: string): Promise<{ metrics: any; raw: any }> {
  let lastErr: any = null;
  for (const metricSet of METRIC_SETS) {
    try {
      const d = await igFetch(env, `/${igMediaId}/insights`, { metric: metricSet.join(',') });
      const metrics: any = {};
      for (const item of d?.data || []) {
        const v = item?.values?.[0]?.value;
        if (v !== undefined) {
          // saved -> saves normalization
          const name = item.name === 'saved' ? 'saves' : item.name;
          metrics[name] = v;
        }
      }
      return { metrics, raw: d };
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('insights unavailable');
}

export async function fetchMediaFields(env: Env, igMediaId: string, fields = 'permalink,timestamp'): Promise<any> {
  return igFetch(env, `/${igMediaId}`, { fields });
}
