// Cloudflare Worker bindings and secrets.
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MEDIA?: R2Bucket;

  // Secrets: local via .dev.vars, production via `wrangler secret put`
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  INTERNAL_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  IG_USER_ID?: string;
  IG_ACCESS_TOKEN?: string;
  IG_GRAPH_VERSION?: string;
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
  REMINDER_EMAIL?: string;
  APP_ORIGIN?: string;
  GH_REPO?: string;
  GH_TOKEN?: string;
}
