import test from 'node:test';
import assert from 'node:assert';
import * as wt from '../../src/shared/weektime.mjs';

test('2026-10-25 is a Sunday in IST (index 6)', () => {
  const sunday = new Date('2026-10-25T12:30:00Z').getTime();
  assert.equal(wt.weekdayIndex(sunday, 'Asia/Kolkata'), 6);
  assert.equal(wt.localParts(sunday, 'Asia/Kolkata').h, 18);
});

test('weekStart returns the Monday of the containing week', () => {
  const sunday = new Date('2026-10-25T12:30:00Z').getTime();
  const ws = wt.weekStart(sunday, 'Asia/Kolkata');
  assert.equal(ws.dateStr, '2026-10-19');
  const monday = new Date('2026-10-26T04:00:00Z').getTime();
  assert.equal(wt.weekStart(monday, 'Asia/Kolkata').dateStr, '2026-10-26');
});

test('weekStartForScript: Sunday submission covers the NEXT week', () => {
  const sunday = new Date('2026-10-25T04:00:00Z').getTime(); // 09:30 IST Sunday
  const t = wt.weekStartForScript(sunday, 'Asia/Kolkata', '18:00');
  assert.equal(t.dateStr, '2026-10-26');
});

test('weekStartForScript: Monday before posting slot covers the SAME week', () => {
  const monday = new Date('2026-10-26T04:00:00Z').getTime(); // 09:30 IST Monday
  const t = wt.weekStartForScript(monday, 'Asia/Kolkata', '18:00');
  assert.equal(t.dateStr, '2026-10-26');
});

test('scheduledForMs: Wednesday 18:00 IST == 12:30 UTC (fixed offset, no DST)', () => {
  const ms = wt.scheduledForMs('2026-10-26', 2, '18:00', 'Asia/Kolkata');
  assert.equal(new Date(ms).toISOString(), '2026-10-28T12:30:00.000Z');
});

test('reminder window opens Sunday 08:00 IST == 02:30 UTC', () => {
  const ms = wt.reminderWindowStartMs('2026-10-26', '08:00', 'Asia/Kolkata');
  assert.equal(new Date(ms).toISOString(), '2026-10-25T02:30:00.000Z');
});

test('DST-safe for non-IST zones (America/New_York fall-back day)', () => {
  const ms = wt.scheduledForMs('2026-11-01', 0, '09:00', 'America/New_York');
  const p = wt.localParts(ms, 'America/New_York');
  assert.equal(p.h, 9);
  assert.equal(p.mo, 11);
});

test('parseHHMM validates', () => {
  assert.equal(wt.parseHHMM('18:00').minutes, 1080);
  assert.equal(wt.parseHHMM('25:00'), null);
  assert.equal(wt.parseHHMM('abc'), null);
});
