// ── Shared types for the Reel Factory worker ──

export interface Env {
  DB: D1Database;
  REELS: R2Bucket;
  AI?: any; // optional Workers AI binding (future use)
  WORKER_URL: string;
  GH_OWNER: string;
  GH_REPO: string;
  USER_EMAIL: string;
  TIMEZONE_OFFSET_MIN: string;
  DEFAULT_POST_TIME_UTC: string;
  // Secrets
  GH_RENDER_TOKEN?: string;
  RENDER_SECRET?: string;
  GEMINI_API_KEY?: string;
  IG_USER_ID?: string;
  IG_ACCESS_TOKEN?: string;
  RESEND_API_KEY?: string;
}

export interface Scene {
  idx: number;            // 0..5
  kind: 'hook' | 'point' | 'quote' | 'cta';
  duration: number;       // seconds (default 10)
  headline: string;       // big kinetic text
  lines?: string[];       // secondary lines
  caption?: string;       // on-screen caption
  narration?: string;     // optional voiceover text (future TTS)
  accent?: string;        // hex accent for this scene
}

export interface Week {
  id: number;
  week_start: string;     // ISO date (Sunday)
  script: string;
  status: 'script_received' | 'splitting' | 'split' | 'rendering' | 'ready' | 'live' | 'completed';
  lessons_used?: string;
  created_at: string;
}

export interface Reel {
  id: number;
  week_id: number;
  post_day: number;       // 0..6 (which day of the week this reel is for)
  caption: string;
  video_url?: string;
  render_status: 'pending' | 'rendered' | 'failed';
  ig_media_id?: string;
  posted_at?: string;
  created_at: string;
}
