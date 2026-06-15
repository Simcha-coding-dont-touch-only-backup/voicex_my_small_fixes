-- Schedule the subscription engine via pg_cron + pg_net.
--
-- The actual order logic lives in the always-on Express API; these jobs just
-- POST to its protected cron endpoints. The API base URL and shared secret are
-- stored in private.cron_settings (NOT hardcoded), so an operator fills them in
-- once per environment:
--
--   insert into private.cron_settings(key, value) values
--     ('api_base_url', 'https://api.your-domain.com'),
--     ('cron_secret',  '<same value as the API CRON_SECRET env var>')
--   on conflict (key) do update set value = excluded.value;
--
-- Until both rows exist, run_subscription_cron() is a no-op (fails closed).
--
-- DST: pg_cron runs in UTC. We fire at BOTH 04:00 and 05:00 UTC (the two hours
-- that map to midnight ET across EST/EDT). The API re-derives the authoritative
-- ET cycle date and every endpoint is idempotent, so the extra fire is a no-op.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cron_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION public.run_subscription_cron(endpoint TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_base TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_base FROM private.cron_settings WHERE key = 'api_base_url';
  SELECT value INTO v_secret FROM private.cron_settings WHERE key = 'cron_secret';
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE 'run_subscription_cron: cron settings missing, skipping %', endpoint;
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_base || endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
END;
$$;

-- 24h pre-run check (flags issues + creates Delivery Issue alerts).
SELECT cron.schedule(
  'subscriptions_prerun',
  '0 4,5 * * *',
  $$SELECT public.run_subscription_cron('/api/cron/subscriptions/prerun')$$
);

-- Lock/snapshot at midnight ET on processing dates, then drain the worker.
SELECT cron.schedule(
  'subscriptions_lock',
  '0 4,5 * * *',
  $$SELECT public.run_subscription_cron('/api/cron/subscriptions/lock')$$
);
