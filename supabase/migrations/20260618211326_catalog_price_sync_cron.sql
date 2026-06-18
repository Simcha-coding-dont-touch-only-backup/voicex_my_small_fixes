-- Schedule the Rainforest catalog price sync near 4AM ET via pg_cron + pg_net.
-- Reuses private.cron_settings (api_base_url, cron_secret) and the existing
-- run_subscription_cron() helper which POSTs to a protected cron endpoint.
--
-- DST: pg_cron runs in UTC. 4AM ET maps to 08:00 UTC (EDT) or 09:00 UTC (EST),
-- so we fire at both. The endpoint gates by the configured interval and is
-- idempotent (it no-ops when an interval has not elapsed or sync is disabled),
-- so the extra fire is harmless.

SELECT cron.schedule(
  'catalog_price_sync',
  '0 8,9 * * *',
  $$SELECT public.run_subscription_cron('/api/cron/catalog/price-sync')$$
);
