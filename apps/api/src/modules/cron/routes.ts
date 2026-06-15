import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config.js';
import {
  runPreRunCheck,
  lockCycle,
  drainDueRuns,
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
 * hours that map to ET midnight across DST. Also kicks the worker so processing
 * starts promptly.
 */
cronRouter.post('/subscriptions/lock', async (_req: Request, res: Response) => {
  try {
    const ensured = await ensureAllUpcomingRuns();
    const result = await lockCycle();
    // Fire-and-forget a drain so processing starts without waiting for the poll.
    drainDueRuns().catch((err) => console.error('[cron] post-lock drain error:', err));
    res.json({ ok: true, ensured, ...result });
  } catch (err) {
    console.error('[cron] lock error:', err);
    res.status(500).json({ error: 'lock failed' });
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
