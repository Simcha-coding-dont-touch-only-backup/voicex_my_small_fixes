-- Serverless-safe subscription drain via pg_cron + pg_net.
--
-- The original design assumed an always-on Express server whose in-process
-- worker drained `locked` runs (charge stored card + create the manual order).
-- On Vercel serverless that worker never starts (guarded by VERCEL !== '1'),
-- so locked runs would never be charged/ordered.
--
-- Instead we drive draining from pg_cron: this job fires frequently and calls
-- the protected, bounded `/api/cron/subscriptions/drain` endpoint, which
-- processes a small batch of locked runs within a wall-clock budget so each
-- invocation finishes inside the serverless function timeout. The endpoint is
-- idempotent and claims runs atomically (locked -> processing), so overlapping
-- fires are safe.
--
-- Reuses public.run_subscription_cron(endpoint) + private.cron_settings
-- (api_base_url, cron_secret) created in 20260615161749_subscriptions_cron.sql.

SELECT cron.schedule(
  'subscriptions_drain',
  '*/2 * * * *',
  $$SELECT public.run_subscription_cron('/api/cron/subscriptions/drain')$$
);
