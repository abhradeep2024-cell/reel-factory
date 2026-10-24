import { Env, Scene } from './types';

// ── Gemini (free tier) : script -> 6 scenes ──
const MODEL = 'gemini-2.0-flash';
const ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

export function buildSplitPrompt(script: string, lessons: string[]): string {
  const lessonBlock = lessons.length
    ? `\nPROVEN LESSONS from previous weeks (apply them!):\n${lessons.map(l => `- ${l}`).join('\n')}\n`
    : '';
  return `You are a short-form video director. Split the SCRIPT below into exactly 6 scenes that form one 60-second vertical (9:16) reel for Instagram.

${lessonBlock}
RULES:
- Scene 1 MUST be a "hook": a 3-6 word punch that stops the scroll in the first 1.5 seconds.
- Scenes 2-5 are "point" or "quote" scenes: one idea each, in escalation order, ending with the strongest insight.
- Scene 6 MUST be a "cta": short call to action (follow / comment / share).
- headline: max 6 words, punchy, no punctuation-heavy phrasing.
- lines: 0-3 short support lines (max 8 words each) that appear one by one.
- caption: 1 sentence on-screen caption for accessibility.
- narration: 15-25 words of voiceover for that scene (used later for TTS).
- Total per scene duration must be 10 seconds (6 x 10 = 60).
- accent: pick a hex color per scene from a cohesive palette (vary but stay harmonious).
- Return ONLY valid JSON, no markdown, exactly this shape:
{"scenes":[{"idx":0,"kind":"hook","duration":10,"headline":"...","lines":["..."],"caption":"...","narration":"...","accent":"#hex"}]}

SCRIPT:
${script}`;
}

export async function splitScript(env: Env, script: string, lessons: string[]): Promise<Scene[]> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set yet');
  const res = await fetch(ENDPOINT(MODEL, env.GEMINI_API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildSplitPrompt(script, lessons) }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 2048, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = JSON.parse(text.trim().replace(/^```json\s*|```$/g, ''));
  const scenes: Scene[] = parsed.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error('Gemini returned no scenes');
  // Normalize: enforce 10s each so total = 60s (auto-extend contract)
  scenes.forEach((s, i) => {
    s.idx = i;
    s.duration = 10;
    s.kind = s.kind || 'point';
    s.lines = Array.isArray(s.lines) ? s.lines.slice(0, 3) : [];
  });
  return scenes;
}

// ── Learning loop: summarize insights into lessons for next week ──
export async function distillLessons(env: Env, statsSummary: string): Promise<string> {
  if (!env.GEMINI_API_KEY) return '';
  const prompt = `You analyze Instagram reel performance. Below are per-reel stats with metadata about hook style and topic.
Produce exactly 3 short, imperative lessons (max 15 words each) about what to do MORE of next week to improve retention and reach. Return a JSON array of strings only.
DATA:
${statsSummary}`;
  try {
    const res = await fetch(ENDPOINT(MODEL, env.GEMINI_API_KEY), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 300, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return '';
    const data: any = await res.json();
    const arr = JSON.parse((data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]').trim());
    return Array.isArray(arr) ? arr.slice(0, 3).join('\n') : '';
  } catch {
    return '';
  }
}
