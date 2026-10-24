// Prompt builders + Gemini response schemas for the planner and insights loops.
import { TEMPLATES, HOOK_STYLES, CAMERAS, TRANSITIONS, MOODS, EMPHASIS, REEL, DAY_ROLES } from './shotsheet.mjs';

export const PLANNER_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    concept: { type: 'STRING' },
    hook_style: { type: 'STRING', enum: HOOK_STYLES },
    template: { type: 'STRING', enum: TEMPLATES },
    caption: { type: 'STRING' },
    hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          duration_sec: { type: 'NUMBER' },
          text: { type: 'STRING' },
          subtext: { type: 'STRING' },
          visual: { type: 'STRING' },
          camera: { type: 'STRING', enum: CAMERAS },
          transition_in: { type: 'STRING', enum: TRANSITIONS },
          emphasis: { type: 'STRING', enum: EMPHASIS },
          mood: { type: 'STRING', enum: MOODS },
        },
        required: ['duration_sec', 'text', 'visual'],
      },
    },
  },
  required: ['title', 'concept', 'hook_style', 'template', 'caption', 'hashtags', 'scenes'],
};

const ROLE_HINTS = {
  hook: 'Day 1: the strongest possible introduction to the topic. Punchy, curious, rewatchable.',
  problem: 'Day 2: the problem or mistake most people make around this topic.',
  insight: 'Day 3: one non-obvious insight or detail that experts know and beginners miss.',
  story: 'Day 4: a mini story or concrete example that makes the topic tangible.',
  method: 'Day 5: a practical how-to / step-by-step method viewers can apply.',
  myth: 'Day 6: debunk a common myth or misconception about the topic.',
  recap: 'Day 7: recap the week, tie the pieces together, end with a clear follow CTA.',
};

export function buildPlannerPrompt({ script, analysis, dayIndex, weekStart, guidance }) {
  const role = DAY_ROLES[((dayIndex % 7) + 7) % 7];
  const system = [
    'You are the head writer of a daily Instagram Reels channel.',
    'You convert a weekly script into seven distinct 60-second vertical (9:16) reels that are rendered as animated motion graphics / anime-style HTML animations - NOT photorealistic footage.',
    'Hard rules:',
    `- Each reel has ${REEL.minScenes}-${REEL.maxScenes} scenes. Every scene duration is between ${REEL.minSceneSec} and ${REEL.maxSceneSec} seconds.`,
    `- Scene durations MUST sum to ${REEL.targetDurationSec} seconds (allowed range ${REEL.minTotalSec}-${REEL.maxTotalSec}).`,
    '- The first scene is the HOOK (3-4 seconds). Use a different hook_style each day.',
    '- Scene text is short and punchy: max 160 characters per scene.',
    '- No misleading claims, no invented statistics, no medical or financial promises.',
    '- Every day covers a DIFFERENT angle of the script; no filler, no repetition between days.',
    '- The visuals field describes motion-graphics motifs (shapes, typography, charts, silhouettes, gradients) - the renderer draws them programmatically.',
    '- Respond with JSON only, exactly matching the provided schema.',
  ].join('\n');
  const user = [
    `WEEK START (Monday): ${weekStart}`,
    `DAY ${dayIndex + 1} OF 7 - ROLE: ${role}`,
    ROLE_HINTS[role],
    '',
    'FULL WEEKLY SCRIPT:',
    '"""',
    String(script || '').slice(0, 20000),
    '"""',
    analysis ? `SCRIPT ANALYSIS: ${JSON.stringify(analysis)}` : '',
    guidance && guidance.length
      ? [
        'CREATIVE GUIDANCE FROM PAST PERFORMANCE DATA (observations, not guarantees - apply where sensible):',
        ...guidance.map((g) => `- [${g.area || 'general'}] ${g.recommendation || g.finding || g}`),
      ].join('\n')
      : '',
    '',
    `Write the reel plan for DAY ${dayIndex + 1} (${role}). JSON only.`,
  ].filter(Boolean).join('\n');
  return { system, user };
}

export function buildRepairPrompt(errors, rawOutput) {
  return [
    'Your previous response failed validation. Fix ALL issues and return the corrected JSON only.',
    'Validation errors:',
    ...errors.map((e) => `- ${e}`),
    '',
    'Your previous response:',
    String(rawOutput || '').slice(0, 4000),
  ].join('\n');
}

export const INSIGHTS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    recommendations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          area: { type: 'STRING' },
          finding: { type: 'STRING' },
          recommendation: { type: 'STRING' },
          confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
        },
        required: ['area', 'finding', 'recommendation', 'confidence'],
      },
    },
  },
  required: ['summary', 'recommendations'],
};

export function buildInsightsPrompt(payload) {
  const system = [
    'You are a careful growth analyst for an Instagram Reels channel.',
    'You receive per-reel performance data collected from the official Instagram API.',
    'Rules:',
    '- Base every statement ONLY on the provided data. Never invent numbers.',
    '- Account for the age of each post (older posts naturally accumulate more views).',
    '- Correlation is not causation: phrase findings as observations and experiments to run.',
    '- Sample sizes are small; prefer conservative, testable recommendations.',
    '- Respond with JSON only, matching the schema.',
  ].join('\n');
  const user = [
    'PERFORMANCE DATA (JSON):',
    '"""',
    JSON.stringify(payload).slice(0, 24000),
    '"""',
    'Produce: 1) an honest summary (2-4 sentences), 2) up to 8 recommendations ranked by expected impact, each with area (hook_style | template | duration | publish_hour | caption), the finding, a concrete recommendation for next week, and confidence.',
  ].join('\n');
  return { system, user };
}
