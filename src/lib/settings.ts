// Settings stored in D1 with safe defaults. Secrets never live here.
import { all, run } from './db';
import type { Env } from './env';

export const SETTING_DEFAULTS: Record<string, string> = {
  posting_time: '18:00',
  timezone: 'Asia/Kolkata',
  auto_approve_publish: 'true',
  reminder_time: '08:00',
  reminder_email: 'abhradeep2024@gmail.com',
  retention_days: '30',
  gemini_model: 'gemini-2.5-flash',
  prompt_version: 'v1',
  caption_suffix: '',
  default_hashtags: '["#reels", "#instagood"]',
  app_origin: '',
};

export const EDITABLE_SETTINGS = [
  'posting_time', 'timezone', 'auto_approve_publish', 'reminder_time', 'reminder_email',
  'retention_days', 'gemini_model', 'caption_suffix', 'default_hashtags', 'app_origin',
];

export async function getSettings(env: Env): Promise<Record<string, string>> {
  const out: Record<string, string> = { ...SETTING_DEFAULTS };
  try {
    const rows = await all<{ key: string; value: string }>(env, 'SELECT key, value FROM settings');
    for (const r of rows) out[r.key] = r.value;
  } catch {
    // table missing (fresh dev db before migrations) - fall back to defaults
  }
  if (!out.app_origin && env.APP_ORIGIN) out.app_origin = env.APP_ORIGIN;
  if (env.REMINDER_EMAIL && out.reminder_email === SETTING_DEFAULTS.reminder_email) {
    out.reminder_email = env.REMINDER_EMAIL;
  }
  return out;
}

export function validateSettings(patch: Record<string, unknown>): {
  ok: boolean;
  errors: string[];
  clean: Record<string, string>;
} {
  const errors: string[] = [];
  const clean: Record<string, string> = {};
  const hhmm = /^\d{2}:\d{2}$/;
  for (const [k, v] of Object.entries(patch)) {
    if (!EDITABLE_SETTINGS.includes(k)) { errors.push(`unknown setting: ${k}`); continue; }
    const s = typeof v === 'string' ? v : String(v);
    switch (k) {
      case 'posting_time':
      case 'reminder_time': {
        if (!hhmm.test(s) || Number(s.slice(0, 2)) > 23 || Number(s.slice(3)) > 59) errors.push(`${k} must be HH:MM`);
        else clean[k] = s;
        break;
      }
      case 'timezone': {
        try {
          new Intl.DateTimeFormat('en', { timeZone: s });
          clean[k] = s;
        } catch {
          errors.push(`${k} is not a valid IANA timezone`);
        }
        break;
      }
      case 'auto_approve_publish':
        if (s === 'true' || s === 'false') clean[k] = s;
        else errors.push('auto_approve_publish must be true or false');
        break;
      case 'reminder_email': {
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) clean[k] = s;
        else errors.push('reminder_email must be an email address');
        break;
      }
      case 'retention_days': {
        const n = Number(s);
        if (Number.isInteger(n) && n >= 7 && n <= 365) clean[k] = s;
        else errors.push('retention_days must be an integer 7-365');
        break;
      }
      case 'default_hashtags': {
        let arr: unknown = v;
        if (typeof v === 'string') {
          try { arr = JSON.parse(v); } catch { arr = null; }
        }
        if (Array.isArray(arr) && arr.length <= 8 && arr.every((h) => typeof h === 'string' && /^#[^\s#]{1,28}$/.test(h))) {
          clean[k] = JSON.stringify(arr);
        } else {
          errors.push('default_hashtags must be a JSON array like ["#reels"], max 8 items');
        }
        break;
      }
      case 'app_origin': {
        if (s === '' || (/^https:\/\/[^\s/$.?#].[^\s]*$/.test(s) && !s.endsWith('/'))) clean[k] = s.replace(/\/+$/, '');
        else errors.push('app_origin must be an https URL without trailing slash (or empty)');
        break;
      }
      default:
        clean[k] = s.slice(0, 200);
    }
  }
  return { ok: errors.length === 0, errors, clean };
}

export async function saveSettings(env: Env, clean: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(clean)) {
    await run(
      env,
      `INSERT INTO settings(key, value, updated_at) VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      k, v,
    );
  }
}
