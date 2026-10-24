import test from 'node:test';
import assert from 'node:assert';
import { buildPlannerPrompt, buildInsightsPrompt, buildRepairPrompt, PLANNER_RESPONSE_SCHEMA, INSIGHTS_RESPONSE_SCHEMA } from '../../src/shared/prompts.mjs';

test('planner prompt embeds script, role, week and guidance', () => {
  const { system, user } = buildPlannerPrompt({
    script: 'SCRIPTBODY',
    analysis: { subject: 'habits' },
    dayIndex: 0,
    weekStart: '2026-10-26',
    guidance: [{ area: 'hook_style', recommendation: 'prefer question hooks' }],
  });
  assert.ok(system.includes('60-second'));
  assert.ok(system.includes('sum to 60 seconds'));
  assert.ok(user.includes('SCRIPTBODY'));
  assert.ok(user.includes('DAY 1 OF 7'));
  assert.ok(user.includes('hook'));
  assert.ok(user.includes('prefer question hooks'));
  assert.ok(user.includes('2026-10-26'));
});

test('each of the 7 days gets its own role in the prompt', () => {
  for (let d = 0; d < 7; d++) {
    const { user } = buildPlannerPrompt({ script: 's', dayIndex: d, weekStart: '2026-10-26' });
    assert.ok(user.includes(`DAY ${d + 1} OF 7`), `day ${d + 1} role missing`);
  }
});

test('repair prompt includes the validation errors', () => {
  const p = buildRepairPrompt(['scene 0: duration_sec must be a number', 'title is required'], '{"title": ""}');
  assert.ok(p.includes('duration_sec must be a number'));
  assert.ok(p.includes('title is required'));
});

test('response schemas are Gemini-shaped objects', () => {
  assert.equal(PLANNER_RESPONSE_SCHEMA.type, 'OBJECT');
  assert.ok(PLANNER_RESPONSE_SCHEMA.properties.scenes);
  assert.equal(INSIGHTS_RESPONSE_SCHEMA.type, 'OBJECT');
  assert.ok(INSIGHTS_RESPONSE_SCHEMA.properties.recommendations);
});

test('insights prompt forbids inventing data', () => {
  const { system, user } = buildInsightsPrompt([{ title: 'r1', views: 100 }]);
  assert.ok(system.includes('Never invent numbers'));
  assert.ok(system.includes('Correlation is not causation'));
  assert.ok(user.includes('views'));
});
