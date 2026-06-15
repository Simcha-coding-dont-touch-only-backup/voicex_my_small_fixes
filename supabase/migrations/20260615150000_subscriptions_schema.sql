-- Subscriptions feature core schema.
--
-- A user has one `subscriptions` row holding the shared address + card and the
-- per-user terms/explanation state. Each subscription has up to 4
-- `subscription_deliveries` (one per "week": week 1 -> 1st, 2 -> 8th, 3 -> 15th,
-- 4 -> 22nd of each month). The live "Package" is `subscription_delivery_items`.
--
-- Each processing cycle a `subscription_delivery_runs` row is created (pending),
-- the package is snapshotted into `subscription_delivery_run_items` at lock time
-- (midnight ET) so later edits only affect the next cycle, and the worker charges
-- the card and creates a manual order. `subscription_events` is the append-only
-- history feed (mirrors order_events / admin_audit_logs).

-- ============================================================
-- SUBSCRIPTIONS (one per user)
-- ============================================================

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_address_id UUID REFERENCES public.addresses(id) ON DELETE SET NULL,
  payment_method_id UUID REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  -- How many times the user has fully heard the explanation. While < 2 the IVR
  -- auto-plays it before the subscription menu; at >= 2 it is just option 9.
  terms_explanation_count INTEGER NOT NULL DEFAULT 0,
  terms_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON public.subscriptions (user_id);

-- ============================================================
-- DELIVERIES (up to 4 per subscription, one per week)
-- ============================================================

CREATE TABLE public.subscription_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  -- Base scheduling status. The admin-facing "Failed" state is derived from the
  -- latest run, not stored here (a failed delivery is still "active").
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','temp_paused','perm_paused')),
  pause_type TEXT CHECK (pause_type IN ('temporary','permanent')),
  -- For temporary pauses: how many monthly cycles were paused (1 or 3).
  paused_cycles INTEGER,
  pause_resume_date DATE,
  paused_at TIMESTAMPTZ,
  -- Next processing date for this week's delivery (recomputed on edits/pauses).
  next_cycle_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, week_number)
);

CREATE INDEX idx_subscription_deliveries_subscription ON public.subscription_deliveries (subscription_id);
CREATE INDEX idx_subscription_deliveries_status ON public.subscription_deliveries (status);
CREATE INDEX idx_subscription_deliveries_next_cycle ON public.subscription_deliveries (next_cycle_date);

-- ============================================================
-- DELIVERY PACKAGE ITEMS (live, editable)
-- ============================================================

CREATE TABLE public.subscription_delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES public.subscription_deliveries(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, product_id)
);

CREATE INDEX idx_subscription_delivery_items_delivery ON public.subscription_delivery_items (delivery_id);
CREATE INDEX idx_subscription_delivery_items_product ON public.subscription_delivery_items (product_id);

-- ============================================================
-- DELIVERY RUNS (queue: one row per delivery per cycle date)
-- ============================================================

CREATE TABLE public.subscription_delivery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES public.subscription_deliveries(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  cycle_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','issue','locked','processing','processed','partial','failed','skipped')),
  -- Estimated/actual processing timestamps.
  scheduled_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  -- The manual order created when the run is processed.
  order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  sola_ref_num TEXT,
  sola_transaction_id TEXT,
  -- Snapshot of charged totals at processing time.
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  -- What flagged it as 'issue' during the 24h pre-run check (retained even if it
  -- later fails) and the failure payload when status='failed'.
  issue_details JSONB,
  failure_details JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  -- user+week+cycle+attempt; passed to Sola as the invoice for traceability.
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, cycle_date)
);

CREATE INDEX idx_subscription_runs_delivery ON public.subscription_delivery_runs (delivery_id);
CREATE INDEX idx_subscription_runs_subscription ON public.subscription_delivery_runs (subscription_id);
CREATE INDEX idx_subscription_runs_user ON public.subscription_delivery_runs (user_id);
CREATE INDEX idx_subscription_runs_status ON public.subscription_delivery_runs (status);
CREATE INDEX idx_subscription_runs_cycle_date ON public.subscription_delivery_runs (cycle_date);
CREATE INDEX idx_subscription_runs_order ON public.subscription_delivery_runs (order_id) WHERE order_id IS NOT NULL;

-- ============================================================
-- DELIVERY RUN ITEMS (immutable snapshot copied at lock time)
-- ============================================================

CREATE TABLE public.subscription_delivery_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.subscription_delivery_runs(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.catalog_products(id) ON DELETE SET NULL,
  voicex_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  -- quantity = what was actually sent; original_quantity = what was requested.
  quantity INTEGER NOT NULL,
  original_quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  amazon_price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'included'
    CHECK (status IN ('included','reduced','skipped_unavailable','skipped_disabled')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_run_items_run ON public.subscription_delivery_run_items (run_id);
CREATE INDEX idx_subscription_run_items_product ON public.subscription_delivery_run_items (product_id);

-- ============================================================
-- SUBSCRIPTION EVENTS (append-only history feed)
-- ============================================================

CREATE TABLE public.subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  delivery_id UUID REFERENCES public.subscription_deliveries(id) ON DELETE SET NULL,
  run_id UUID REFERENCES public.subscription_delivery_runs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('admin','hotline','system')),
  actor_admin_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_events_subscription ON public.subscription_events (subscription_id);
CREATE INDEX idx_subscription_events_delivery ON public.subscription_events (delivery_id);
CREATE INDEX idx_subscription_events_run ON public.subscription_events (run_id);
CREATE INDEX idx_subscription_events_created ON public.subscription_events (created_at DESC);

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_subscription_deliveries_updated_at BEFORE UPDATE ON public.subscription_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_subscription_delivery_items_updated_at BEFORE UPDATE ON public.subscription_delivery_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_subscription_delivery_runs_updated_at BEFORE UPDATE ON public.subscription_delivery_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS (service-role only, matching the rest of the schema)
-- ============================================================

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_delivery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_delivery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_delivery_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ADMIN_ALERTS: subscription-aware columns
-- ============================================================

-- user_id makes the User filter / name+phone+email joins clean for subscription
-- alerts (which use entity_type = 'subscription_delivery'); heard_at is the
-- user-facing "tag" (whether the customer heard it on the hotline), distinct
-- from the admin workflow `status` column.
ALTER TABLE public.admin_alerts
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS heard_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_admin_alerts_user_id ON public.admin_alerts (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_alerts_heard_at ON public.admin_alerts (heard_at);

-- ============================================================
-- ORDERS: link subscription-generated orders + Type column
-- ============================================================

-- subscription_week_number is null for normal cart orders (Type "Cart") and 1-4
-- for subscription orders (Type "Week N"); subscription_delivery_run_id links
-- back to the run that produced the order.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS subscription_delivery_run_id UUID REFERENCES public.subscription_delivery_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subscription_week_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_orders_subscription_week ON public.orders (subscription_week_number) WHERE subscription_week_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_subscription_run ON public.orders (subscription_delivery_run_id) WHERE subscription_delivery_run_id IS NOT NULL;
