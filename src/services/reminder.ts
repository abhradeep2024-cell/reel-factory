// Weekly script reminder: daily check at reminder_time (default 08:00 IST).
// Sends only while the upcoming week's script is missing; stops once submitted.
// Deduplicated to one email per day; logged in the reminders table.
import type { Env } from '../lib/env';
import { one, run } from '../lib/db';
import { logEvent } from '../lib/events';
import { getSettings } from '../lib/settings';
import { sendMail } from './mail';
import { weekStartForScript, reminderWindowStartMs, localParts, wallToUTC } from '../shared/weektime.mjs';

export async function checkReminder(
  env: Env,
  nowMs: number = Date.now(),
): Promise<{ sent: boolean; reason: string; weekStart?: string; to?: string }> {
  const settings = await getSettings(env);
  const tz = settings.timezone;
  const target = weekStartForScript(nowMs, tz, settings.posting_time);

  const script = await one(env, 'SELECT id FROM scripts WHERE week_start = ?', target.dateStr);
  if (script) return { sent: false, reason: 'script already submitted', weekStart: target.dateStr };

  const windowStart = reminderWindowStartMs(target.dateStr, settings.reminder_time, tz);
  if (nowMs < windowStart) return { sent: false, reason: 'reminder window not open yet', weekStart: target.dateStr };

  // dedupe: max one reminder per local day
  const p = localParts(nowMs, tz);
  const dayStartIso = new Date(wallToUTC(p.y, p.mo, p.d, 0, 0, tz)).toISOString();
  const already = await one(env,
    'SELECT id FROM reminders WHERE week_start = ? AND sent_at >= ? LIMIT 1',
    target.dateStr, dayStartIso);
  if (already) return { sent: false, reason: 'already reminded today', weekStart: target.dateStr };

  const to = settings.reminder_email;
  const subject = `Reel Factory: weekly script due for week of ${target.dateStr}`;
  const text = [
    'Hi!',
    '',
    `This is your daily ${settings.reminder_time} (${tz}) reminder from Reel Factory.`,
    '',
    `No script has been submitted yet for the week starting Monday ${target.dateStr}.`,
    '',
    'Open the dashboard and paste this week\u2019s script - the factory takes it from there:',
    '7 reels will be planned, rendered and scheduled automatically.',
    '',
    `This reminder repeats daily at ${settings.reminder_time} ${tz} until the script is submitted.`,
  ].join('\n');

  const res = await sendMail(env, { to, subject, text });
  await run(env,
    'INSERT INTO reminders(week_start, provider, status, detail) VALUES (?,?,?,?)',
    target.dateStr, res.provider, res.ok ? 'sent' : 'failed', res.detail || null);
  await logEvent(env, res.ok ? 'info' : 'error', 'reminder',
    `${res.ok ? 'Sent' : 'Failed to send'} weekly-script reminder for week ${target.dateStr} (${res.provider})`,
    { to, weekStart: target.dateStr });
  return { sent: res.ok, reason: res.ok ? 'reminder sent' : `send failed: ${res.detail}`, weekStart: target.dateStr, to };
}
