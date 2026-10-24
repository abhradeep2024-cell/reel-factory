// Gemini API client (structured JSON output, retry with backoff, graceful errors).
// Free-tier aware: expects 429s and handles them; never assumes unlimited capacity.
import type { Env } from '../lib/env';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status = 0, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export function geminiConfigured(env: Env): boolean {
  return !!env.GEMINI_API_KEY;
}

export async function callGeminiJson(
  env: Env,
  opts: { system: string; user: string; responseSchema: unknown; model?: string; temperature?: number; maxRetries?: number },
): Promise<any> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new GeminiError('GEMINI_API_KEY not configured', 0, false);
  const model = opts.model || env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `${API_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    system_instruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.8,
      responseMimeType: 'application/json',
      responseSchema: opts.responseSchema,
    },
  };
  const maxRetries = opts.maxRetries ?? 2;
  let lastErr: GeminiError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1500 + 800));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new GeminiError(`Gemini HTTP ${res.status} (rate limit or transient error)`, res.status, true);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new GeminiError(`Gemini HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, false);
      }
      const data: any = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new GeminiError('Gemini returned no candidate text (possibly safety-blocked)', 0, false);
      try {
        return JSON.parse(text);
      } catch {
        throw new GeminiError('Gemini returned invalid JSON', 0, false);
      }
    } catch (e: any) {
      if (e instanceof GeminiError) {
        if (!e.retryable) throw e;
        lastErr = e;
        continue;
      }
      lastErr = new GeminiError(`Gemini network error: ${e?.message || e}`, 0, true);
    }
  }
  throw lastErr || new GeminiError('Gemini failed after retries', 0, false);
}
