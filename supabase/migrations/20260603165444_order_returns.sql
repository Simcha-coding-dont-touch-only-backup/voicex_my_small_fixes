-- Order returns ledger: header (order_returns), line items (order_return_items),
-- and admin-entered fees (order_return_fees). Also relaxes admin_alerts so
-- user-scoped alert types (e.g. high_returning_user) can exist without a product.

-- Distinct, human-friendly return IDs (5-digit, start at 50001 to avoid
-- visual collision with order numbers that start at 10001).
CREATE SEQUENCE IF NOT EXISTS order_returns_id_seq AS BIGINT INCREMENT BY 1 MINVALUE 50001 MAXVALUE 9223372036854775807 START 50001;

CREATE TABLE public.order_returns (
  id BIGINT PRIMARY KEY DEFAULT nextval('order_returns_id_seq'),
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','complete','cancelled','rejected','deleted')),
  source TEXT NOT NULL DEFAULT 'ivr' CHECK (source IN ('ivr','admin')),
  -- What the customer paid for the returned items (unit_price * qty), pre-tax.
  item_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  -- Tax refunded to the customer; seeded proportionally, admin-editable.
  tax_refund_cents INTEGER NOT NULL DEFAULT 0,
  -- Amount expected/received back from Amazon (amazon_price * qty), admin-editable.
  amazon_refund_cents INTEGER NOT NULL DEFAULT 0,
  -- Admin marks once the customer has actually been refunded (done off-platform).
  refunded BOOLEAN NOT NULL DEFAULT FALSE,
  refunded_at TIMESTAMPTZ,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER SEQUENCE order_returns_id_seq OWNED BY public.order_returns.id;

CREATE INDEX idx_order_returns_order ON public.order_returns (order_id);
CREATE INDEX idx_order_returns_user ON public.order_returns (user_id);
CREATE INDEX idx_order_returns_status ON public.order_returns (status);
CREATE INDEX idx_order_returns_created ON public.order_returns (created_at DESC);

CREATE TABLE public.order_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id BIGINT NOT NULL REFERENCES public.order_returns(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  -- Snapshots so reporting stays stable even if the catalog product changes.
  product_id UUID,
  voicex_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL,
  amazon_price_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_return_items_return ON public.order_return_items (return_id);
CREATE INDEX idx_order_return_items_order_item ON public.order_return_items (order_item_id);
CREATE INDEX idx_order_return_items_product ON public.order_return_items (product_id);

CREATE TABLE public.order_return_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id BIGINT NOT NULL REFERENCES public.order_returns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_return_fees_return ON public.order_return_fees (return_id);

CREATE TRIGGER trg_order_returns_updated_at BEFORE UPDATE ON public.order_returns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- All access is via the service role (which bypasses RLS). Enabling RLS with
-- no policies denies the anon/authenticated roles, satisfying Supabase advisors.
ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_return_fees ENABLE ROW LEVEL SECURITY;

-- Allow non-product (user-scoped) alerts in admin_alerts.
ALTER TABLE public.admin_alerts ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.admin_alerts ALTER COLUMN entity_type DROP DEFAULT;
CREATE UNIQUE INDEX idx_admin_alerts_user_alert_type
  ON public.admin_alerts (entity_id, alert_type)
  WHERE entity_type = 'user';
