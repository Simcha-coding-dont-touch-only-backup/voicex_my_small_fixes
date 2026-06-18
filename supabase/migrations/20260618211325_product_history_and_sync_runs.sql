-- Product change history log (price + status changes), with source attribution.
CREATE TABLE IF NOT EXISTS public.product_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('price', 'status')),
  old_value TEXT,
  new_value TEXT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('admin', 'system', 'checkout')),
  actor_label TEXT NOT NULL,
  actor_admin_user_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_history_product_created
  ON public.product_history (product_id, created_at DESC);

-- Sync runs feed the Product Sync report. Every sync type writes a run.
CREATE TABLE IF NOT EXISTS public.product_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger TEXT NOT NULL CHECK (trigger IN ('auto', 'manual_full', 'manual_single', 'manual_bulk', 'checkout')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'paused', 'failed')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('admin', 'system', 'checkout')),
  actor_label TEXT NOT NULL,
  actor_admin_user_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  caller_phone TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_product_sync_runs_started
  ON public.product_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_sync_runs_trigger
  ON public.product_sync_runs (trigger);

CREATE TABLE IF NOT EXISTS public.product_sync_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.product_sync_runs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  old_amazon_price_cents INTEGER,
  new_amazon_price_cents INTEGER,
  direction TEXT CHECK (direction IN ('up', 'down')),
  became_unavailable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_sync_run_items_run
  ON public.product_sync_run_items (run_id);

-- Seed new settings (idempotent).
INSERT INTO public.settings (key, value, description) VALUES
  ('rainforest_auto_sync_enabled', 'false', 'Enable scheduled Rainforest Amazon price sync'),
  ('rainforest_sync_interval_hours', '24', 'Hours between scheduled Rainforest price syncs'),
  ('rainforest_checkout_revalidation_enabled', 'false', 'Re-check product prices/availability against Rainforest at checkout (manual fulfillment)')
ON CONFLICT (key) DO NOTHING;
