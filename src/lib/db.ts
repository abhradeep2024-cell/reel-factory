// Thin D1 query helpers.
import type { Env } from './env';

export function nowIso(): string {
  return new Date().toISOString();
}

export async function all<T = any>(env: Env, sql: string, ...params: any[]): Promise<T[]> {
  const { results } = await env.DB.prepare(sql).bind(...params).all<T>();
  return results ?? [];
}

export async function one<T = any>(env: Env, sql: string, ...params: any[]): Promise<T | null> {
  return await env.DB.prepare(sql).bind(...params).first<T>();
}

export async function run(env: Env, sql: string, ...params: any[]): Promise<D1Result> {
  return await env.DB.prepare(sql).bind(...params).run();
}

export function jsonParse<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
