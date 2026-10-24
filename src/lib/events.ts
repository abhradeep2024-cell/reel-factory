// Audit log: every notable action lands in the events table (dashboard "Activity").
import { all, run } from './db';
import type { Env } from './env';

export type EventLevel = 'info' | 'warn' | 'error';
export type EventSource = 'api' | 'planner' | 'render' | 'publisher' | 'metrics' | 'insights' | 'cron' | 'system' | 'reminder' | 'email';

export async function logEvent(
  env: Env,
  level: EventLevel,
  source: EventSource,
  message: string,
  data?: unknown,
): Promise<void> {
  try {
    await run(
      env,
      'INSERT INTO events(level, source, message, data) VALUES (?,?,?,?)',
      level, source, message, data === undefined ? null : JSON.stringify(data),
    );
  } catch (e) {
    console.error('event log failed', e);
  }
}

export async function listEvents(
  env: Env,
  opts: { limit?: number; level?: string; source?: string } = {},
): Promise<any[]> {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500);
  const where: string[] = [];
  const params: any[] = [];
  if (opts.level) { where.push('level = ?'); params.push(opts.level); }
  if (opts.source) { where.push('source = ?'); params.push(opts.source); }
  const sql = `SELECT id, ts, level, source, message, data FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
  params.push(limit);
  return all(env, sql, ...params);
}
