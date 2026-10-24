// Deterministic mock planner: script -> 7 schema-valid reel plans, no AI call.
// Used when GEMINI_API_KEY is absent (the dashboard clearly labels planner mode)
// and by tests and the offline sample render. Seeded PRNG => same script, same output.
import { normalizeReelPlan, DAY_ROLES } from './shotsheet.mjs';

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

function firstWords(s, n) {
  const w = String(s || '').split(' ');
  return w.slice(0, n).join(' ').replace(/[.,!?;:]+$/, '');
}

function titleCase(s) {
  return String(s || '').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

const HOOK_LINES = {
  hook: 'Stop scrolling. This changes how you see it.',
  problem: 'Almost everyone gets this wrong. Do you?',
  insight: 'One detail almost nobody talks about.',
  story: 'This started like any ordinary day.',
  method: 'The exact steps. No fluff.',
  myth: 'You have been told a lie. Here is the truth.',
  recap: 'Everything that matters, in sixty seconds.',
};
const PAYOFF_LINE = 'That is the whole idea.';
const CTA_LINES = [
  'Follow for tomorrow.',
  'Save this before you forget.',
  'Share it with someone who needs it.',
  'Comment your take below.',
];
const TEMPLATES_BY_DAY = ['kinetic', 'anime', 'story', 'motion', 'kinetic', 'anime', 'motion'];
const MOODS_BY_DAY = ['bold', 'dark', 'bright', 'calm', 'pastel', 'bold', 'bright'];
const HOOK_STYLES_BY_DAY = ['question', 'challenge', 'contrarian', 'story_open', 'promise', 'shocking_stat', 'visual_pattern_break'];
const CAMERA_CYCLE = ['zoom_in', 'static', 'pan_left', 'zoom_out', 'static', 'pan_right', 'shake', 'zoom_in', 'static'];
const TRANSITION_CYCLE = ['fade', 'cut', 'slide', 'cut', 'dip_to_black', 'cut', 'slide', 'cut', 'fade'];

export function analyzeScript(script) {
  const ss = sentences(script);
  return {
    subject: ss[0] ? firstWords(ss[0], 14) : 'the weekly topic',
    audience: 'Instagram Reels viewers interested in this topic',
    tone: 'energetic, clear, curiosity-driven',
    key_points: ss.slice(0, 5),
  };
}

export function mockReelPlan(script, dayIndex) {
  const day = ((dayIndex % 7) + 7) % 7;
  const role = DAY_ROLES[day];
  const rng = mulberry32(hashString(script) ^ ((day + 1) * 2654435761));
  const pool = sentences(script);
  if (!pool.length) pool.push('The topic in one line.', 'Why it matters.', 'What to do next.');
  const offset = (day * 3) % pool.length;
  const pick = (i) => pool[(offset + i) % pool.length];

  const hook = HOOK_LINES[role];
  const cta = CTA_LINES[Math.floor(rng() * CTA_LINES.length)];
  const title = titleCase(firstWords(pick(0), 6)) || `Day ${day + 1}`;

  const texts = [
    hook,
    ...[0, 1, 2, 3, 4, 5].map((i) => firstWords(pick(i), 12)),
    PAYOFF_LINE,
    cta,
  ];
  // 9 scenes summing to exactly 60s
  const durations = [4, 7, 8, 7, 8, 7, 8, 6, 5];

  const scenes = texts.map((text, i) => ({
    index: i,
    duration_sec: durations[i],
    text,
    visual: i === 0
      ? 'Bold hook text over an animated gradient with drifting shapes'
      : `Illustrate: ${firstWords(pick(i % pool.length), 10)}`,
    camera: CAMERA_CYCLE[i % CAMERA_CYCLE.length],
    transition_in: TRANSITION_CYCLE[i % TRANSITION_CYCLE.length],
    emphasis: i === 0 || i === texts.length - 2 ? 'hard' : 'soft',
    mood: MOODS_BY_DAY[day],
  }));

  const total = scenes.reduce((a, s) => a + s.duration_sec, 0);
  const delta = 60 - total;
  if (delta !== 0) {
    let li = 0;
    scenes.forEach((s, i) => { if (s.duration_sec > scenes[li].duration_sec) li = i; });
    scenes[li].duration_sec = Math.round((scenes[li].duration_sec + delta) * 10) / 10;
  }

  const tagWord = firstWords(title, 1).toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalizeReelPlan({
    title,
    concept: `${titleCase(role)} angle for day ${day + 1}: ${firstWords(pick(0), 18)}`,
    hook_style: HOOK_STYLES_BY_DAY[day],
    template: TEMPLATES_BY_DAY[day],
    caption: `${hook} ${firstWords(pick(0), 20)} ${cta}`,
    hashtags: ['#reels', '#instagood', ...(tagWord ? [`#${tagWord}`] : [])],
    scenes,
  });
}

export function mockPlanWeek(script) {
  const plans = [];
  for (let d = 0; d < 7; d++) plans.push(mockReelPlan(script, d));
  return plans;
}
