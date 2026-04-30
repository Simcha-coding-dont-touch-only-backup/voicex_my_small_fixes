CREATE TABLE IF NOT EXISTS order_fulfillment_etas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  eta_date DATE NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, sort_order)
);

ALTER TABLE order_fulfillment_etas ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_order_fulfillment_etas_order_sort
  ON order_fulfillment_etas (order_id, sort_order);

DROP TRIGGER IF EXISTS trg_order_fulfillment_etas_updated_at ON order_fulfillment_etas;
CREATE TRIGGER trg_order_fulfillment_etas_updated_at
  BEFORE UPDATE ON order_fulfillment_etas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
