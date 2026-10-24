// Auth routes: login (rate-limited), logout, session check.
import { Hono } from 'hono';
import type { Env } from '../lib/env';
import {
  checkPassword, issueSessionCookie, clearSessionCookie, verifySession,
  loginBlocked, loginFailed, loginSucceeded,
} from '../lib/auth';
import { logEvent } from '../lib/events';

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = String(body?.password || '');
  if (!password) return c.json({ error: 'password required' }, 400);
  if (await loginBlocked(c.env)) {
    return c.json({ error: 'too many failed attempts - try again in 15 minutes' }, 429);
  }
  if (!(await checkPassword(c.env, password))) {
    await loginFailed(c.env);
    await logEvent(c.env, 'warn', 'api', 'Failed dashboard login attempt');
    return c.json({ error: 'invalid password' }, 401);
  }
  await loginSucceeded(c.env);
  const isSecure = new URL(c.req.url).protocol === 'https:';
  c.header('Set-Cookie', await issueSessionCookie(c.env, isSecure));
  await logEvent(c.env, 'info', 'api', 'Dashboard login succeeded');
  return c.json({ ok: true });
});

authRoutes.post('/logout', async (c) => {
  c.header('Set-Cookie', await clearSessionCookie());
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  return c.json({ authenticated: await verifySession(c.env, c.req.raw) });
});
