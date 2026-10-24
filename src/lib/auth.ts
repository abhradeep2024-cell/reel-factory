// Session auth: password login -> HMAC-signed HttpOnly cookie; internal API key guard.
import type { Context, Next } from 'hono';
import { hmacHex, timingSafeEqualStr } from './crypto';
import { one, run, nowIso } from './db';
import type { Env } from './env';

export const SESSION_COOKIE = 'rfw_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

async function sign(env: Env, payload: string): Promise<string> {
  return (await hmacHex(env.SESSION_SECRET || 'insecure-dev-secret', payload)).slice(0, 40);
}

export async function issueSessionCookie(env: Env, isSecure: boolean): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  const value = `${exp}.${await sign(env, String(exp))}`;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${isSecure ? '; Secure' : ''}`;
}

export async function clearSessionCookie(): Promise<string> {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function verifySession(env: Env, req: Request): Promise<boolean> {
  const cookie = req.headers.get('Cookie') || '';
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return false;
  const [expStr, sig] = m[1].split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false;
  const expected = await sign(env, expStr);
  return timingSafeEqualStr(sig, expected);
}

export async function checkPassword(env: Env, password: string): Promise<boolean> {
  const real = env.ADMIN_PASSWORD || '';
  if (!real || !password) return false;
  return timingSafeEqualStr(password, real);
}

// --- login rate limiting (5 failures per 15 minutes) ---
export async function loginBlocked(env: Env): Promise<boolean> {
  const row = await one<{ fail_count: number; window_start: string }>(env, 'SELECT fail_count, window_start FROM login_throttle WHERE key = ?', 'global');
  if (!row) return false;
  const age = Date.now() - new Date(row.window_start || 0).getTime();
  if (age > WINDOW_MS) return false;
  return row.fail_count >= MAX_FAILS;
}

export async function loginFailed(env: Env): Promise<void> {
  const row = await one<{ fail_count: number; window_start: string }>(env, 'SELECT fail_count, window_start FROM login_throttle WHERE key = ?', 'global');
  const fresh = !row || (Date.now() - new Date(row.window_start || 0).getTime()) > WINDOW_MS;
  if (fresh) {
    await run(env, `INSERT INTO login_throttle(key, fail_count, window_start) VALUES ('global', 1, ?)
      ON CONFLICT(key) DO UPDATE SET fail_count = 1, window_start = excluded.window_start`, nowIso());
  } else {
    await run(env, `UPDATE login_throttle SET fail_count = fail_count + 1 WHERE key = 'global'`);
  }
}

export async function loginSucceeded(env: Env): Promise<void> {
  await run(env, `UPDATE login_throttle SET fail_count = 0 WHERE key = 'global'`);
}

// --- Hono middleware ---
export async function requireAuth(c: Context, next: Next) {
  if (!(await verifySession(c.env as Env, c.req.raw))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
}

export async function requireInternalKey(c: Context, next: Next) {
  const provided = c.req.header('X-Internal-Key') || '';
  const real = (c.env as Env).INTERNAL_API_KEY || '';
  if (!real || !timingSafeEqualStr(provided, real)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
}
