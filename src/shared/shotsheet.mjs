// Shot sheet schema, validation and normalization.
// Shared by: the Worker planner, the Node render pipeline and tests.
// Concept adapted from github.com/blixvip/html-anime (MIT): a shot sheet
// describes scenes with explicit durations that must sum exactly to the runtime.

export const TEMPLATES = ['kinetic', 'anime', 'motion', 'story'];
export const HOOK_STYLES = ['question', 'shocking_stat', 'challenge', 'story_open', 'contrarian', 'promise', 'visual_pattern_break'];
export const CAMERAS = ['static', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'tilt_up', 'shake'];
export const TRANSITIONS = ['cut', 'fade', 'dip_to_black', 'dip_to_white', 'slide'];
export const MOODS = ['bold', 'calm', 'dark', 'bright', 'pastel'];
export const EMPHASIS = ['none', 'soft', 'hard'];

export const REEL = {
  width: 1080,
  height: 1920,
  fps: 30,
  targetDurationSec: 60,
  minTotalSec: 56,
  maxTotalSec: 64,
  minScenes: 5,
  maxScenes: 14,
  minSceneSec: 2,
  maxSceneSec: 12,
};

// Each day of the week plays a different narrative role.
export const DAY_ROLES = ['hook', 'problem', 'insight', 'story', 'method', 'myth', 'recap'];

const isStr = (v) => typeof v === 'string';
const str = (v, max, fallback = '') => (isStr(v) ? v.slice(0, max) : fallback);

export function validateReelPlan(plan, opts = {}) {
  const o = {
    minScenes: opts.minScenes ?? REEL.minScenes,
    maxScenes: opts.maxScenes ?? REEL.maxScenes,
    minSceneSec: opts.minSceneSec ?? REEL.minSceneSec,
    maxSceneSec: opts.maxSceneSec ?? REEL.maxSceneSec,
    minTotalSec: opts.minTotalSec ?? REEL.minTotalSec,
    maxTotalSec: opts.maxTotalSec ?? REEL.maxTotalSec,
  };
  const errors = [];
  let total = 0;
  let totalOk = true;
  if (!plan || typeof plan !== 'object') {
    return { ok: false, errors: ['plan must be an object'], totalDurationSec: 0 };
  }
  if (!str(plan.title, 80)) errors.push('title is required (max 80 chars)');
  if (!str(plan.concept, 400)) errors.push('concept is required (max 400 chars)');
  if (!TEMPLATES.includes(plan.template)) errors.push(`template must be one of: ${TEMPLATES.join(', ')}`);
  if (plan.hook_style !== undefined && !HOOK_STYLES.includes(plan.hook_style)) {
    errors.push(`hook_style must be one of: ${HOOK_STYLES.join(', ')}`);
  }
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : null;
  if (!scenes) {
    errors.push(`scenes must be an array of ${o.minScenes}-${o.maxScenes} items`);
  } else {
    if (scenes.length < o.minScenes || scenes.length > o.maxScenes) {
      errors.push(`scenes must be an array of ${o.minScenes}-${o.maxScenes} items (got ${scenes.length})`);
    }
    scenes.forEach((s, i) => {
      const sc = s || {};
      const d = Number(sc.duration_sec);
      if (!Number.isFinite(d) || d < o.minSceneSec || d > o.maxSceneSec) {
        errors.push(`scene ${i}: duration_sec must be a number between ${o.minSceneSec} and ${o.maxSceneSec}`);
        totalOk = false;
      } else {
        total += d;
      }
      if (!str(sc.text, 160)) errors.push(`scene ${i}: text is required (max 160 chars)`);
      if (sc.camera !== undefined && !CAMERAS.includes(sc.camera)) errors.push(`scene ${i}: camera must be one of: ${CAMERAS.join(', ')}`);
      if (sc.transition_in !== undefined && !TRANSITIONS.includes(sc.transition_in)) errors.push(`scene ${i}: transition_in must be one of: ${TRANSITIONS.join(', ')}`);
      if (sc.mood !== undefined && !MOODS.includes(sc.mood)) errors.push(`scene ${i}: mood must be one of: ${MOODS.join(', ')}`);
      if (sc.emphasis !== undefined && !EMPHASIS.includes(sc.emphasis)) errors.push(`scene ${i}: emphasis must be one of: ${EMPHASIS.join(', ')}`);
    });
  }
  if (totalOk && total > 0 && (total < o.minTotalSec || total > o.maxTotalSec)) {
    errors.push(`scene durations sum to ${total}s; must be between ${o.minTotalSec}s and ${o.maxTotalSec}s (target ${REEL.targetDurationSec}s)`);
  }
  if (plan.hashtags !== undefined) {
    const bad = !Array.isArray(plan.hashtags) || plan.hashtags.length > 8 ||
      plan.hashtags.some((h) => !isStr(h) || !/^#[^\s#]{1,28}$/.test(h));
    if (bad) errors.push('hashtags must be an array of at most 8 strings like #example');
  }
  if (plan.caption !== undefined && (!isStr(plan.caption) || plan.caption.length > 2200)) {
    errors.push('caption must be a string of at most 2200 chars');
  }
  return { ok: errors.length === 0, errors, totalDurationSec: Math.round(total * 10) / 10 };
}

export function normalizeReelPlan(plan) {
  const scenes = (plan.scenes || []).map((s, i) => ({
    index: i,
    duration_sec: Math.round(Number(s.duration_sec) * 10) / 10,
    text: str(s.text, 160).trim(),
    subtext: str(s.subtext, 160).trim() || undefined,
    visual: str(s.visual, 220).trim(),
    camera: CAMERAS.includes(s.camera) ? s.camera : 'static',
    transition_in: TRANSITIONS.includes(s.transition_in) ? s.transition_in : (i === 0 ? 'fade' : 'cut'),
    emphasis: EMPHASIS.includes(s.emphasis) ? s.emphasis : 'soft',
    mood: MOODS.includes(s.mood) ? s.mood : 'bold',
  }));
  return {
    title: str(plan.title, 80).trim(),
    concept: str(plan.concept, 400).trim(),
    hook_style: HOOK_STYLES.includes(plan.hook_style) ? plan.hook_style : 'promise',
    template: TEMPLATES.includes(plan.template) ? plan.template : 'kinetic',
    caption: str(plan.caption, 2200).trim(),
    hashtags: (Array.isArray(plan.hashtags) ? plan.hashtags : [])
      .filter((h) => isStr(h) && /^#[^\s#]{1,28}$/.test(h)).slice(0, 8),
    scenes,
    duration_sec: Math.round(scenes.reduce((a, s) => a + s.duration_sec, 0) * 10) / 10,
  };
}
