-- Add provider-neutral manual fulfillment support.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_provider TEXT NOT NULL DEFAULT 'rye',
  ADD COLUMN IF NOT EXISTS fulfillment_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS external_order_id TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_notes TEXT,
  ADD COLUMN IF NOT EXISTS fulfilled_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_fulfillment_provider_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_fulfillment_provider_check
  CHECK (fulfillment_provider IN ('rye', 'manual'));

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_fulfillment_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_fulfillment_status_check
  CHECK (fulfillment_status IN ('none', 'queued', 'ordered', 'needs_review', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_provider_status
  ON orders (fulfillment_provider, fulfillment_status);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS amazon_asin TEXT,
  ADD COLUMN IF NOT EXISTS amazon_url TEXT;

UPDATE order_items oi
SET
  amazon_asin = cp.amazon_asin,
  amazon_url = cp.amazon_url
FROM catalog_products cp
WHERE oi.product_id = cp.id
  AND (oi.amazon_asin IS NULL OR oi.amazon_url IS NULL);

INSERT INTO settings (key, value, description)
VALUES
  ('active_fulfillment_provider', 'rye', 'Active checkout fulfillment provider: rye or manual'),
  ('amazon_associate_tag', 'voicexshop20-20', 'Amazon Associate tag used for manual fulfillment cart links')
ON CONFLICT (key) DO NOTHING;
