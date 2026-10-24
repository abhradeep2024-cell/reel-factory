// Learning loop: real recorded metrics -> heuristic stats -> (optional) Gemini
// recommendations -> stored insights -> guidance for the next planning cycle.
import type { Env } from '../lib/env';
import { run } from '../lib/db';
import { logEvent } from '../lib/events';
import { getSettings } from '../lib/settings';
import { shortId } from '../lib/crypto';
import { heuristicInsights } from '../shared/engagement.mjs';
import { buildInsightsPrompt, INSIGHTS_RESPONSE_SCHEMA } from '../shared/prompts.mjs';
import { callGeminiJson, geminiConfigured } from './gemini';
import { comparisonItems } from './metrics';

export async function generateInsights(
  env: Env,
): Promise<{ ok: boolean; model: string; enough: boolean; id?: string; error?: string }> {
  const items = await comparisonItems(env);
  const heur = heuristicInsights(items);
  let model = 'heuristic';
  let summary = heur.summary;
  let recommendations: any[] = heur.recommendations;

  if (geminiConfigured(env) && heur.enough) {
    try {
      const settings = await getSettings(env);
      const payload = heur.comparison.rows.map((r: any) => ({
        title: r.reel.title,
        day: r.reel.day_index,
        hook_style: r.reel.hook_style,
        template: r.reel.template,
        duration_sec: r.reel.duration_sec,
        publish_hour: r.reel.publish_hour_local,
        engagement_rate: r.engagement_rate,
        views_per_hour: r.views_per_hour,
        engagement_vs_median: r.engagement_vs_median,
      }));
      const { system, user } = buildInsightsPrompt(payload);
      const out = await callGeminiJson(env, {
        system, user, responseSchema: INSIGHTS_RESPONSE_SCHEMA,
        model: settings.gemini_model, temperature: 0.4,
      });
      if (out?.summary && Array.isArray(out.recommendations)) {
        model = 'gemini';
        summary = String(out.summary).slice(0, 1200);
        recommendations = out.recommendations.slice(0, 8);
      }
    } catch (e: any) {
      await logEvent(env, 'warn', 'insights',
        `Gemini insights enrichment failed, keeping heuristic result: ${e?.message || e}`);
    }
  }

  const id = shortId('ins');
  const withMetrics = items.filter((it) => it.metrics).length;
  await run(env,
    `INSERT INTO insights(id, summary, recommendations, based_on_reels, based_on_metrics, model, raw)
     VALUES (?,?,?,?,?,?,?)`,
    id, summary, JSON.stringify(recommendations), items.length, withMetrics, model,
    JSON.stringify(heur.comparison).slice(0, 100000));
  await logEvent(env, 'info', 'insights',
    `Insights generated (${model}; ${items.length} reels, ${withMetrics} with metrics)`);
  return { ok: true, model, enough: heur.enough, id };
}
