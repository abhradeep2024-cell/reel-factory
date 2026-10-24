// Cron handlers. Cloudflare Cron Triggers (UTC) invoke these; the same functions
// are exposed via /internal/cron/:name (internal key) for manual runs, tests and
// the GitHub Actions fallback path.
//   "30 2 * * *"  -> 08:00 IST daily   -> reminder check
//   "0 * * * *"   -> hourly            -> recover/retry jobs, publish due, sync metrics
//   "35 2 * * 1"  -> Mon 08:05 IST     -> weekly planner safety net
import type { Env } from '../lib/env';
import { all, one } from '../lib/db';
import { logEvent } from '../lib/events';
import { getSettings } from '../lib/settings';
import { checkReminder } from './reminder';
import { recoverStaleJobs, enqueueRender } from './renderqueue';
import { publishDue } from './publish';
import { syncMetrics } from './metrics';
import { planWeek } from './planner';
import { weekStart } from '../shared/weektime.mjs';

export async function runReminderCron(env: Env) {
  const r = await checkReminder(env);
  await logEvent(env, 'info', 'cron', `Reminder check: ${r.reason}`, r as any);
  return r;
}

export async function runHourlyCron(env: Env) {
  const out: any = {};
  out.recovered = await recoverStaleJobs(env);
  out.retried = await retryFailedRenders(env);
  out.publish = await publishDue(env);
  out.metrics = await syncMetrics(env);
  await logEvent(env, 'info', 'cron',
    `Hourly tick: publish ${out.publish.published}p/${out.publish.dryRun ?? out.publish.dry_run}dry/${out.publish.failed}f, metrics ${out.metrics.updated}, recovered ${out.recovered}, retried ${out.retried}`);
  return out;
}

async function retryFailedRenders(env: Env): Promise<number> {
  const rows = await all<any>(env, `SELECT id FROM reels WHERE status = 'render_failed'`);
  let n = 0;
  for (const r of rows) {
    const jobCount = await one<any>(env, 'SELECT COUNT(*) AS n FROM render_jobs WHERE reel_id = ?', r.id);
    if (jobCount && jobCount.n >= 3) continue;
    const jid = await enqueueRender(env, r.id);
    if (jid) n++;
  }
  return n;
}

export async function runWeeklyCron(env: Env) {
  const settings = await getSettings(env);
  const ws = weekStart(Date.now(), settings.timezone).dateStr;
  const script = await one<any>(env, 'SELECT * FROM scripts WHERE week_start = ?', ws);
  if (!script) {
    await logEvent(env, 'warn', 'cron', `Weekly planner: no script submitted for week ${ws}`);
    return { planned: false, reason: 'no script' };
  }
  if (script.status !== 'planned') {
    const res = await planWeek(env, script.id);
    return { planned: res.ok, mode: res.mode, error: res.error };
  }
  const reels = await all<any>(env,
    'SELECT id, status FROM reels WHERE script_id = ? AND week_start = ?', script.id, ws);
  let queued = 0;
  for (const reel of reels) {
    if (['planned', 'render_failed'].includes(reel.status)) {
      const jid = await enqueueRender(env, reel.id);
      if (jid) queued++;
    }
  }
  await logEvent(env, 'info', 'cron', `Weekly planner: ${queued} render job(s) queued for week ${ws}`);
  return { planned: true, queued };
}
