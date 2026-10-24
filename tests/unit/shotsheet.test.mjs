import test from 'node:test';
import assert from 'node:assert';
import { validateReelPlan, normalizeReelPlan, REEL } from '../../src/shared/shotsheet.mjs';
import { mockPlanWeek, mockReelPlan, analyzeScript } from '../../src/shared/mockplanner.mjs';

const script = `Test script with several sentences. Each sentence teaches one idea. The system turns this into seven reels. Durations must sum to sixty seconds. Hooks vary by day across the week. No repetition allowed between days. Final line for the recap.`;

test('mock planner produces 7 valid plans summing to 60s', () => {
  const plans = mockPlanWeek(script);
  assert.equal(plans.length, 7);
  for (const p of plans) {
    const v = validateReelPlan(p);
    assert.ok(v.ok, `plan invalid: ${v.errors.join('; ')}`);
    assert.equal(v.totalDurationSec, 60);
    assert.ok(p.scenes.length >= REEL.minScenes && p.scenes.length <= REEL.maxScenes);
  }
});

test('mock planner is deterministic (same script, same output)', () => {
  const a = JSON.stringify(mockReelPlan(script, 3));
  const b = JSON.stringify(mockReelPlan(script, 3));
  assert.equal(a, b);
});

test('each day uses a distinct hook style and rotating template', () => {
  const plans = mockPlanWeek(script);
  assert.equal(new Set(plans.map((p) => p.hook_style)).size, 7);
  assert.ok(new Set(plans.map((p) => p.template)).size >= 3);
});

test('validator rejects invalid plans with useful errors', () => {
  assert.equal(validateReelPlan({ title: 'x', concept: 'y', template: 'kinetic', scenes: [] }).ok, false);
  const bad = validateReelPlan({
    title: 't', concept: 'c', template: 'nope',
    scenes: [{ duration_sec: 500, text: 'x', visual: 'v' }],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('template')));
  assert.ok(bad.errors.some((e) => e.includes('duration_sec')));

  const wrongTotal = validateReelPlan({
    title: 't', concept: 'c', template: 'kinetic',
    scenes: Array.from({ length: 5 }, () => ({ duration_sec: 2, text: 'a', visual: 'b' })),
  });
  assert.equal(wrongTotal.ok, false);
  assert.ok(wrongTotal.errors.some((e) => e.includes('sum to 10s')));
});

test('relaxed validation allows short test films (duration-cap mode)', () => {
  const p = mockReelPlan(script, 0);
  const scaled = {
    ...p,
    scenes: p.scenes.slice(0, 2).map((s) => ({ ...s, duration_sec: 1 })),
    duration_sec: 2,
  };
  assert.equal(validateReelPlan(scaled, { minScenes: 2, minSceneSec: 0.4, minTotalSec: 2, maxTotalSec: 999 }).ok, true);
  assert.equal(validateReelPlan(scaled).ok, false);
});

test('normalize clamps and fills defaults', () => {
  const n = normalizeReelPlan({
    title: 'T', concept: 'C', template: 'anime',
    scenes: [{ duration_sec: 4, text: 'hello', visual: 'v', camera: 'warp', mood: 'neon' }],
    hashtags: ['#ok', 'bad', '#ThisIsWayTooLongForAHashtagYesIndeed'],
  });
  assert.equal(n.scenes[0].camera, 'static');
  assert.equal(n.scenes[0].mood, 'bold');
  assert.deepEqual(n.hashtags, ['#ok']);
});

test('analyzeScript extracts key points', () => {
  const a = analyzeScript(script);
  assert.ok(a.subject.length > 5);
  assert.ok(a.key_points.length >= 3);
});
