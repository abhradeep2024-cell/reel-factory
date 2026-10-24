// Pure date/week math for any IANA timezone (DST-safe via Intl).
// No I/O. Shared by the Worker, the render pipeline and tests.

const DEFAULT_TZ = 'Asia/Kolkata';

export function localParts(ms, tz = DEFAULT_TZ) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  let h = Number(parts.hour);
  if (h === 24) h = 0;
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h, mi: Number(parts.minute) };
}

export function localDateStr(ms, tz = DEFAULT_TZ) {
  const p = localParts(ms, tz);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

// 0 = Monday .. 6 = Sunday
export function weekdayIndex(ms, tz = DEFAULT_TZ) {
  const p = localParts(ms, tz);
  const utcDay = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  return (utcDay + 6) % 7;
}

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return { h, mi, minutes: h * 60 + mi };
}

// Wall-clock time in tz -> UTC ms (iterative, DST-boundary safe)
export function wallToUTC(y, mo, d, h, mi, tz = DEFAULT_TZ) {
  let ts = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  const target = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  for (let i = 0; i < 2; i++) {
    const p = localParts(ts, tz);
    const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0, 0);
    if (asUTC === target) break;
    ts += target - asUTC;
  }
  return ts;
}

// Monday 00:00 local of the week containing ms
export function weekStart(ms, tz = DEFAULT_TZ) {
  const p = localParts(ms, tz);
  const idx = weekdayIndex(ms, tz);
  const mondayUTC = wallToUTC(p.y, p.mo, p.d - idx, 0, 0, tz);
  return { dateStr: localDateStr(mondayUTC, tz), ms: mondayUTC };
}

export function addDaysDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function dateStrToMondayMs(dateStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return wallToUTC(y, m, d, 0, 0, tz);
}

// The week a script submitted at `ms` covers:
//  - submitted on Monday BEFORE the daily posting slot -> current week
//  - anything else (the normal Sunday cadence)        -> the following week
export function weekStartForScript(ms, tz = DEFAULT_TZ, postingTime = '18:00') {
  const pt = parseHHMM(postingTime) || { h: 18, mi: 0 };
  const idx = weekdayIndex(ms, tz);
  const ws = weekStart(ms, tz);
  if (idx === 0) {
    const p = localParts(ms, tz);
    if (p.h * 60 + p.mi < pt.h * 60 + pt.mi) return ws;
  }
  const next = addDaysDateStr(ws.dateStr, 7);
  return { dateStr: next, ms: dateStrToMondayMs(next, tz) };
}

// UTC ms at which a reel publishes: weekStart + dayIndex days + posting time
export function scheduledForMs(weekStartStr, dayIndex, postingTime, tz = DEFAULT_TZ) {
  const pt = parseHHMM(postingTime) || { h: 18, mi: 0 };
  const [y, m, d] = addDaysDateStr(weekStartStr, dayIndex).split('-').map(Number);
  return wallToUTC(y, m, d, pt.h, pt.mi, tz);
}

// Reminder window opens at reminder_time on the Sunday BEFORE the target week
export function reminderWindowStartMs(weekStartStr, reminderTime = '08:00', tz = DEFAULT_TZ) {
  const rt = parseHHMM(reminderTime) || { h: 8, mi: 0 };
  const [y, m, d] = addDaysDateStr(weekStartStr, -1).split('-').map(Number);
  return wallToUTC(y, m, d, rt.h, rt.mi, tz);
}

export function fmtLocal(ms, tz = DEFAULT_TZ) {
  const p = localParts(ms, tz);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

export default {
  DEFAULT_TZ, localParts, localDateStr, weekdayIndex, parseHHMM, wallToUTC,
  weekStart, weekStartForScript, addDaysDateStr, scheduledForMs,
  reminderWindowStartMs, fmtLocal,
};
