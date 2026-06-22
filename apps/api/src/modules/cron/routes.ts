import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config.js';
import {
  runPreRunCheck,
  lockCycle,
  drainDueRunsBatch,
} from '../../lib/subscription-engine.js';
import { ensureAllUpcomingRuns, resumeDueDeliveries } from '../../lib/subscriptions.js';
import {
  getRainforestSyncSettings,
  getLastFullSyncStartedAt,
  startScheduledFullSync,
  drainScheduledSync,
  SYSTEM_ACTOR,
} from '../../lib/product-sync.js';

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
    const resumed = await resumeDueDeliveries();
    const ensured = await ensureAllUpcomingRuns();
    const result = await runPreRunCheck();
    res.json({ ok: true, resumed, ensured, ...result });
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
    const resumed = await resumeDueDeliveries();
    const ensured = await ensureAllUpcomingRuns();
    const result = await lockCycle();
    const drained = await drainDueRunsBatch();
    res.json({ ok: true, resumed, ensured, ...result, drained });
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

/**
 * Scheduled Rainforest catalog price sync (start). Fired daily near 4AM ET
 * (dual UTC hours for DST). No-op when auto-sync is disabled or the configured
 * interval has not yet elapsed since the last full sync. Otherwise it *starts*
 * a durable, resumable run (persists the eligible product queue) and kicks off
 * the first bounded batch; the frequent `price-sync-drain` cron continues the
 * run until its queue is empty. Syncs active products only and skips products
 * updated within the last 12 hours to save Rainforest credits.
 */
cronRouter.post('/catalog/price-sync', async (_req: Request, res: Response) => {
  try {
    const settings = await getRainforestSyncSettings();
    if (!settings.autoSyncEnabled) {
      res.json({ ok: true, skipped: 'auto_sync_disabled' });
      return;
    }

    const lastFull = await getLastFullSyncStartedAt();
    if (lastFull) {
      const now = new Date();
      const elapsedHours = (now.getTime() - lastFull.getTime()) / (60 * 60 * 1000);

      // For a daily cadence we gate by calendar day (UTC) rather than raw
      // elapsed hours. The cron fires twice daily (08:00 + 09:00 UTC for DST),
      // and each run's `started_at` drifts a little later than the previous
      // day's due to processing latency. A raw `< interval` check would then
      // skip a day whenever drift pushes elapsed just under 24h, while a fixed
      // hour tolerance lets syncs run meaningfully early. Day-based gating skips
      // the duplicate same-day fire but always runs once per day without ever
      // firing before the interval has truly elapsed.
      const isDaily = settings.intervalHours >= 23 && settings.intervalHours <= 25;
      const alreadySyncedToday =
        lastFull.getUTCFullYear() === now.getUTCFullYear() &&
        lastFull.getUTCMonth() === now.getUTCMonth() &&
        lastFull.getUTCDate() === now.getUTCDate();

      const shouldSkip = isDaily ? alreadySyncedToday : elapsedHours < settings.intervalHours;
      if (shouldSkip) {
        res.json({ ok: true, skipped: 'interval_not_elapsed', elapsedHours });
        return;
      }
    }

    const started = await startScheduledFullSync({
      trigger: 'auto',
      actor: SYSTEM_ACTOR,
      skipRecentlyUpdated: true,
    });
    if (!started.started) {
      res.json({ ok: true, ...started });
      return;
    }
    // Kick off the first batch within this invocation so progress begins
    // promptly; the drain cron continues the rest.
    const drained = await drainScheduledSync();
    res.json({ ok: true, started: true, runId: started.runId, total: started.total, drained });
  } catch (err) {
    console.error('[cron] catalog price-sync error:', err);
    res.status(500).json({ error: 'catalog price-sync failed' });
  }
});

/**
 * Serverless-safe price sync drain. Triggered frequently by Supabase pg_cron to
 * continue an in-progress scheduled (auto/manual_full) run a bounded batch at a
 * time so each call finishes inside the serverless function timeout. Also
 * reconciles dead runs to 'failed'. Idempotent and safe to overlap (the run is
 * leased atomically).
 */
cronRouter.post('/catalog/price-sync-drain', async (_req: Request, res: Response) => {
  try {
    const drained = await drainScheduledSync();
    res.json({ ok: true, ...drained });
  } catch (err) {
    console.error('[cron] catalog price-sync-drain error:', err);
    res.status(500).json({ error: 'catalog price-sync-drain failed' });
  }
});

/** Manual trigger to ensure upcoming runs exist (safety net / first-run seed). */
cronRouter.post('/subscriptions/ensure', async (_req: Request, res: Response) => {
  try {
    const resumed = await resumeDueDeliveries();
    const ensured = await ensureAllUpcomingRuns();
    res.json({ ok: true, resumed, ...ensured });
  } catch (err) {
    console.error('[cron] ensure error:', err);
    res.status(500).json({ error: 'ensure failed' });
  }
});
