-- Make the Rainforest catalog price sync durable and serverless-safe.
--
-- Previously a single daily cron fire awaited a monolithic loop over the whole
-- catalog (368+ products, 1.5s apart). On Vercel that loop is killed by the
-- function timeout after only a handful of products, leaving the run row stuck
-- in 'running' forever (never finalized, so never shown as failed/red), and the
-- interval gate then treats that stuck row as "already synced today" so no
-- further run ever starts.
--
-- The fix mirrors the subscription drain pattern: a run persists its pending
-- product-id queue, a frequent cron drains a bounded batch per invocation, and
-- runs resume across invocations purely from the DB.

-- 1) Persist the work queue + a heartbeat so runs can resume and so dead runs
--    can be detected on a time basis (not only when the next sync starts).
ALTER TABLE public.product_sync_runs
  ADD COLUMN IF NOT EXISTS pending_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;

-- Fast lookup of the active scheduled run to drain (one at a time).
CREATE INDEX IF NOT EXISTS idx_product_sync_runs_active_scheduled
  ON public.product_sync_runs (started_at)
  WHERE status = 'running' AND trigger IN ('auto', 'manual_full');

-- 2) Retune cron schedules. cron.schedule() upserts by jobname.
--    - The daily job now only STARTS a scheduled run (interval-gated) and kicks
--      off the first batch. Same name + endpoint as before.
--    - A new frequent job drains a bounded batch every 2 minutes, continuing any
--      in-progress scheduled run inside each serverless function timeout.
SELECT cron.schedule(
  'catalog_price_sync',
  '0 8,9 * * *',
  $$SELECT public.run_subscription_cron('/api/cron/catalog/price-sync')$$
);

SELECT cron.schedule(
  'catalog_price_sync_drain',
  '*/2 * * * *',
  $$SELECT public.run_subscription_cron('/api/cron/catalog/price-sync-drain')$$
);

-- 3) One-time cleanup: fail out any scheduled run currently stuck in 'running'
--    so the report reflects reality (red) instead of an eternal in-progress row.
UPDATE public.product_sync_runs
SET status = 'failed',
    finished_at = now()
WHERE status = 'running'
  AND trigger IN ('auto', 'manual_full');
