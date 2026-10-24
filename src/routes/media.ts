// Public media streaming from R2 (the Instagram crawler and the dashboard
// both fetch MP4s/thumbnails here). Supports byte ranges.
import { Hono } from 'hono';
import type { Env } from '../lib/env';

export const mediaRoutes = new Hono<{ Bindings: Env }>();

function parseRange(header: string): { offset: number; length?: number } | undefined {
  const m = /bytes=(\d+)-(\d*)/.exec(header);
  if (!m) return undefined;
  const offset = Number(m[1]);
  if (m[2] === '') return { offset };
  const end = Number(m[2]);
  return { offset, length: end - offset + 1 };
}

mediaRoutes.get('*', async (c) => {
  if (!c.env.MEDIA) {
    return c.json({ error: 'media storage not configured (deploy with R2 enabled)' }, 404);
  }
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''));
  if (!key || key.includes('..')) return c.json({ error: 'not found' }, 404);
  const rangeHeader = c.req.header('range');
  const obj = await c.env.MEDIA.get(key, rangeHeader ? { range: parseRange(rangeHeader) } : undefined);
  if (!obj) return c.json({ error: 'not found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=3600');
  if (rangeHeader && obj.range) {
    headers.set('content-range', `bytes ${obj.range.offset}-${obj.range.end}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
});
