// Metric aggregation, fair comparison and heuristic insights (no AI).
// Only analyzes metrics actually recorded from the Instagram API.
export function computeEngagementRate(m = {}) {
  const denom = Math.max(Number(m.views ?? m.reach ?? 0) || 0, 1);
  const inter = (Number(m.likes) || 0) + (Number(m.comments) || 0) +
    (Number(m.shares) || 0) + (Number(m.saves) || 0);
  return Math.round((inter / denom) * 10000) / 10000;
}

export function latestByReel(snapshots = []) {
  const map = new Map();
  for (const s of snapshots) {
    const cur = map.get(s.reel_id);
    if (!cur || String(s.captured_at) > String(cur.captured_at)) map.set(s.reel_id, s);
  }
  return map;
}

// items: [{ reel: {id, week_start, day_index, title, hook_style, template, duration_sec, publish_hour_local},
//            metrics: latest snapshot (or null) }]
export function buildComparison(items) {
  const rows = items
    .filter((it) => it.metrics && (Number(it.metrics.views) > 0 || Number(it.metrics.reach) > 0))
    .map((it) => {
      const m = it.metrics;
      const ageH = Math.max(Number(m.age_hours) || 1, 1);
      const views = Number(m.views ?? m.reach ?? 0) || 0;
      return {
        reel: it.reel,
        metrics: m,
        engagement_rate: Number(m.engagement_rate ?? computeEngagementRate(m)) || 0,
        views_per_hour: Math.round((views / ageH) * 100) / 100,
      };
    });
  if (!rows.length) return { rows: [], enough: false, medianEngagement: null };
  const rates = rows.map((r) => r.engagement_rate).sort((a, b) => a - b);
  const median = rates[Math.floor(rates.length / 2)] || 0.0001;
  for (const r of rows) {
    r.engagement_vs_median = Math.round((r.engagement_rate / median) * 100) / 100;
  }
  return { rows, enough: rows.length >= 3, medianEngagement: median };
}

function bucketStats(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()]
    .map(([k, rs]) => ({
      key: k,
      n: rs.length,
      avgEngagementVsMedian: Math.round((rs.reduce((a, r) => a + (r.engagement_vs_median || 0), 0) / rs.length) * 100) / 100,
      avgViewsPerHour: Math.round((rs.reduce((a, r) => a + r.views_per_hour, 0) / rs.length) * 100) / 100,
    }))
    .filter((g) => g.n >= 3);
}

export function heuristicInsights(items) {
  const cmp = buildComparison(items);
  if (!cmp.enough) {
    return {
      model: 'heuristic',
      enough: false,
      summary: `Not enough performance data yet (${cmp.rows.length} reel(s) with metrics; at least 3 are needed). Insights appear automatically once more published reels have real analytics.`,
      recommendations: [],
      comparison: { rows: [], enough: false, medianEngagement: null },
    };
  }
  const dims = [
    ['hook_style', (r) => r.reel.hook_style],
    ['template', (r) => r.reel.template],
    ['duration', (r) => (Number(r.reel.duration_sec) >= 58 ? 'full_60s' : 'shorter')],
    ['publish_hour', (r) => r.reel.publish_hour_local ?? null],
  ];
  const recommendations = [];
  for (const [area, fn] of dims) {
    for (const g of bucketStats(cmp.rows, fn)) {
      let recommendation;
      if (g.avgEngagementVsMedian >= 1.15) recommendation = `Lean toward ${area} "${g.key}" in upcoming weeks while still testing alternatives.`;
      else if (g.avgEngagementVsMedian <= 0.85) recommendation = `Reduce reliance on ${area} "${g.key}" and test a different approach.`;
      else recommendation = `Keep ${area} "${g.key}" as a neutral baseline.`;
      recommendations.push({
        area,
        finding: `${area} "${g.key}" across ${g.n} reels: ${g.avgEngagementVsMedian}x median engagement, ${g.avgViewsPerHour} views/hour average.`,
        recommendation,
        confidence: g.n >= 5 ? 'medium' : 'low',
      });
    }
  }
  const summary = `Based on ${cmp.rows.length} reels with real API metrics (median engagement rate ${(cmp.medianEngagement * 100).toFixed(2)}%). These are observed correlations, not proven causes - treat them as experiment ideas and keep tracking outcomes.`;
  return {
    model: 'heuristic',
    enough: true,
    summary,
    recommendations: recommendations.slice(0, 8),
    comparison: {
      rows: cmp.rows.map((r) => ({ reel: r.reel, engagement_rate: r.engagement_rate, views_per_hour: r.views_per_hour, engagement_vs_median: r.engagement_vs_median })),
      enough: cmp.enough,
      medianEngagement: cmp.medianEngagement,
    },
  };
}
