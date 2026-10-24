import test from 'node:test';
import assert from 'node:assert';
import { computeEngagementRate, buildComparison, heuristicInsights } from '../../src/shared/engagement.mjs';

const mk = (id, hook, views, likes, age = 24) => ({
  reel: {
    id, week_start: '2026-10-26', day_index: id, title: 'r' + id,
    hook_style: hook, template: 'kinetic', duration_sec: 60, publish_hour_local: 18,
  },
  metrics: {
    views, likes, comments: 2, shares: 1, saves: 3, age_hours: age,
    engagement_rate: computeEngagementRate({ views, likes, comments: 2, shares: 1, saves: 3 }),
  },
});

test('engagement rate computation', () => {
  assert.equal(computeEngagementRate({ views: 100, likes: 10, comments: 5, shares: 5, saves: 5 }), 0.25);
  assert.equal(computeEngagementRate({}), 0);
  assert.equal(computeEngagementRate({ views: 0, likes: 4 }), 4);
});

test('buildComparison needs at least 3 reels with metrics', () => {
  assert.equal(buildComparison([mk(1, 'question', 100, 10)]).enough, false);
  const items = [mk(1, 'question', 100, 10), mk(2, 'question', 200, 30), mk(3, 'challenge', 150, 5), mk(4, 'challenge', 300, 10)];
  const c = buildComparison(items);
  assert.equal(c.enough, true);
  assert.ok(c.medianEngagement !== null);
  assert.equal(c.rows.length, 4);
});

test('heuristicInsights flags strong patterns and disclaims causation', () => {
  const items = [
    mk(1, 'question', 1000, 120), mk(2, 'question', 2000, 260), mk(3, 'question', 1500, 190),
    mk(4, 'challenge', 1000, 10), mk(5, 'challenge', 2000, 22), mk(6, 'challenge', 1500, 15),
    mk(7, 'challenge', 900, 4), mk(8, 'challenge', 1200, 6),
  ];
  const h = heuristicInsights(items);
  assert.equal(h.enough, true);
  assert.ok(h.summary.includes('correlations'), 'summary must disclaim causation');
  const q = h.recommendations.find((r) => r.area === 'hook_style' && r.finding.includes('question'));
  assert.ok(q, 'question-hook finding exists');
  assert.ok(q.recommendation.includes('Lean toward'));
  const c = h.recommendations.find((r) => r.area === 'hook_style' && r.finding.includes('challenge'));
  assert.ok(c.recommendation.includes('Reduce reliance'));
});

test('heuristicInsights is honest when there is no data', () => {
  const h = heuristicInsights([]);
  assert.equal(h.enough, false);
  assert.ok(h.summary.includes('Not enough'));
  assert.deepEqual(h.recommendations, []);
});
