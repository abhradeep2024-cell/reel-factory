// Weekly planning: script -> analysis + 7 schema-validated reel plans.
// Gemini when configured; deterministic mock when not (clearly labeled).
// Gemini failures are NOT silently mocked - the script is marked planning_failed.
import type { Env } from '../lib/env';
import { one, run, nowIso, jsonParse } from '../lib/db';
import { logEvent } from '../lib/events';
import { getSettings } from '../lib/settings';
import { shortId } from '../lib/crypto';
import { callGeminiJson, geminiConfigured } from './gemini';
import { validateReelPlan, normalizeReelPlan } from '../shared/shotsheet.mjs';
import { analyzeScript, mockPlanWeek } from '../shared/mockplanner.mjs';
import { buildPlannerPrompt, buildRepairPrompt, PLANNER_RESPONSE_SCHEMA } from '../shared/prompts.mjs';

export async function latestGuidance(env: Env): Promise<any[]> {
  const rows = await one<{ recommendations: string }>(env, 'SELECT recommendations FROM insights ORDER BY created_at DESC LIMIT 1');
  return rows ? (jsonParse<any[]>(rows.recommendations, []) || []).slice(0, 6) : [];
}

export async function planWeek(
  env: Env,
  scriptId: string,
): Promise<{ ok: boolean; mode: string; reels: string[]; error?: string }> {
  const script = await one<any>(env, 'SELECT * FROM scripts WHERE id = ?', scriptId);
  if (!script) return { ok: false, mode: 'none', reels: [], error: 'script not found' };
  const settings = await getSettings(env);
  const guidance = await latestGuidance(env);

  await run(env, 'UPDATE scripts SET status = ? WHERE id = ?', 'planning', scriptId);
  const useGemini = geminiConfigured(env);
  try {
    const analysis = analyzeScript(script.content);
    const plans: any[] = [];
    if (useGemini) {
      for (let d = 0; d < 7; d++) {
        const { system, user } = buildPlannerPrompt({
          script: script.content,
          analysis,
          dayIndex: d,
          weekStart: script.week_start,
          guidance,
        });
        let raw = await callGeminiJson(env, {
          system, user, responseSchema: PLANNER_RESPONSE_SCHEMA,
          model: settings.gemini_model, temperature: 0.85,
        });
        let v = validateReelPlan(raw);
        if (!v.ok) {
          raw = await callGeminiJson(env, {
            system, user: buildRepairPrompt(v.errors, JSON.stringify(raw)),
            responseSchema: PLANNER_RESPONSE_SCHEMA,
            model: settings.gemini_model, temperature: 0.3,
          });
          v = validateReelPlan(raw);
        }
        if (!v.ok) throw new Error(`day ${d + 1} plan invalid after repair: ${v.errors.slice(0, 4).join('; ')}`);
        plans.push(normalizeReelPlan(raw));
      }
    } else {
      plans.push(...mockPlanWeek(script.content));
    }

    // idempotent replan: drop previous reels/jobs for this script
    await run(env, 'DELETE FROM render_jobs WHERE reel_id IN (SELECT id FROM reels WHERE script_id = ?)', scriptId);
    await run(env, 'DELETE FROM publications WHERE reel_id IN (SELECT id FROM reels WHERE script_id = ?)', scriptId);
    await run(env, 'DELETE FROM reels WHERE script_id = ?', scriptId);

    const ids: string[] = [];
    for (let d = 0; d < plans.length; d++) {
      const p = plans[d];
      const id = shortId('reel');
      await run(
        env,
        `INSERT INTO reels(id, script_id, week_start, day_index, title, concept, hook_style, template,
           shot_sheet, caption, hashtags, status, prompt_version, guidance, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'planned', ?,?,?,?)`,
        id, scriptId, script.week_start, d, p.title, p.concept, p.hook_style, p.template,
        JSON.stringify(p), p.caption, JSON.stringify(p.hashtags),
        settings.prompt_version, JSON.stringify(guidance), nowIso(), nowIso(),
      );
      ids.push(id);
    }
    await run(env, 'UPDATE scripts SET status = ?, analysis = ?, prompt_version = ? WHERE id = ?',
      'planned', JSON.stringify(analysis), settings.prompt_version, scriptId);
    await logEvent(env, 'info', 'planner',
      `Planned ${plans.length} reels for week ${script.week_start} (mode: ${useGemini ? 'gemini' : 'mock'})`, { script: scriptId });
    return { ok: true, mode: useGemini ? 'gemini' : 'mock', reels: ids };
  } catch (e: any) {
    await run(env, 'UPDATE scripts SET status = ? WHERE id = ?', 'planning_failed', scriptId);
    await logEvent(env, 'error', 'planner',
      `Planning failed for week ${script.week_start}: ${e?.message || e}`, { script: scriptId });
    return { ok: false, mode: useGemini ? 'gemini' : 'mock', reels: [], error: String(e?.message || e) };
  }
}
