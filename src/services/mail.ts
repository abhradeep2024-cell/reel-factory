// Outbound email. Providers: resend | brevo | log (default).
// Reminders only ever go to the configured owner email, so any free tier suffices.
import type { Env } from '../lib/env';
import { logEvent } from '../lib/events';

export async function sendMail(
  env: Env,
  opts: { to: string; subject: string; text: string; html?: string },
): Promise<{ provider: string; ok: boolean; detail?: string }> {
  const provider = (env.EMAIL_PROVIDER || 'log').toLowerCase();
  const html = opts.html || `<pre style="font:14px/1.5 -apple-system,Segoe UI,sans-serif">${opts.text}</pre>`;
  try {
    if (provider === 'resend' && env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Reel Factory <onboarding@resend.dev>',
          to: [opts.to],
          subject: opts.subject,
          text: opts.text,
          html,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { provider: 'resend', ok: true };
    }
    if (provider === 'brevo' && env.BREVO_API_KEY) {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: 'Reel Factory', email: 'no-reply@reel-factory.local' },
          to: [{ email: opts.to }],
          subject: opts.subject,
          textContent: opts.text,
          htmlContent: html,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`brevo HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { provider: 'brevo', ok: true };
    }
    console.log(`[email:log] to=${opts.to} subject="${opts.subject}"\n${opts.text}`);
    return { provider: 'log', ok: true, detail: 'logged only - no email provider configured' };
  } catch (e: any) {
    await logEvent(env, 'error', 'email',
      `Email send failed via ${provider}: ${e?.message || e}`, { to: opts.to, subject: opts.subject });
    return { provider, ok: false, detail: String(e?.message || e) };
  }
}
