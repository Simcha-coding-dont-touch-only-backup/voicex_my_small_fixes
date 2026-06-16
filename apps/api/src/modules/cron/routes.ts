import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config.js';
import {
  runPreRunCheck,
  lockCycle,
  drainDueRunsBatch,
} from '../../lib/subscription-engine.js';
import { ensureAllUpcomingRuns } from '../../lib/subscriptions.js';

export const cronRouter = Router();

/**
 * Shared-secret guard. pg_cron (via pg_net) must send
 * `Authorization: Bearer <CRON_SECRET>`. If no secret is configured the
 * endpoints are disabled (fail closed) to avoid an open trigger surface.
 */
function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = config.cron.secret;
  if (!secret) {
    res.status(503).json({ error: 'Cron endpoints are disabled (CRON_SECRET not set)' });
    return;
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

cronRouter.use(requireCronSecret);

/**
 * 24h pre-run check. Ensures upcoming runs exist, then flags any with
 * issues (expired/missing card, no address, all-disabled package). Idempotent.
 */
cronRouter.post('/subscriptions/prerun', async (_req: Request, res: Response) => {
  try {
    const ensured = await ensureAllUpcomingRuns();
    const result = await runPreRunCheck();
    res.json({ ok: true, ensured, ...result });
  } catch (err) {
    console.error('[cron] prerun error:', err);
    res.status(500).json({ error: 'prerun failed' });
  }
});

/**
 * Lock + snapshot at the processing date (midnight ET). Re-derives the ET
 * calendar date itself and is idempotent, so it is safe to fire at both UTC
 * hours that map to ET midnight across DST. Kicks off a bounded, awaited drain
 * so processing starts promptly within this invocation; the frequent `drain`
 * cron continues draining whatever remains locked.
 */
cronRouter.post('/subscriptions/lock', async (_req: Request, res: Response) => {
  try {
    const ensured = await ensureAllUpcomingRuns();
    const result = await lockCycle();
    const drained = await drainDueRunsBatch();
    res.json({ ok: true, ensured, ...result, drained });
  } catch (err) {
    console.error('[cron] lock error:', err);
    res.status(500).json({ error: 'lock failed' });
  }
});

/**
 * Serverless-safe drain. Triggered frequently by Supabase pg_cron to charge
 * stored cards and create the manual orders for locked runs, a bounded batch at
 * a time so each call finishes inside the serverless function timeout.
 * Idempotent and safe to overlap (runs are claimed atomically).
 */
cronRouter.post('/subscriptions/drain', async (_req: Request, res: Response) => {
  try {
    const drained = await drainDueRunsBatch();
    res.json({ ok: true, ...drained });
  } catch (err) {
    console.error('[cron] drain error:', err);
    res.status(500).json({ error: 'drain failed' });
  }
});

/** Manual trigger to ensure upcoming runs exist (safety net / first-run seed). */
cronRouter.post('/subscriptions/ensure', async (_req: Request, res: Response) => {
  try {
    const ensured = await ensureAllUpcomingRuns();
    res.json({ ok: true, ...ensured });
  } catch (err) {
    console.error('[cron] ensure error:', err);
    res.status(500).json({ error: 'ensure failed' });
  }
});
