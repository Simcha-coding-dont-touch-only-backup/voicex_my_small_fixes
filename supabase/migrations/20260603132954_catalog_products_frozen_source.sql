ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS frozen_source TEXT
  CHECK (frozen_source IS NULL OR frozen_source IN ('auto', 'manual'));

UPDATE catalog_products p
SET status = 'frozen',
    frozen_source = 'auto',
    updated_at = now()
FROM admin_alerts a
WHERE a.product_id = p.id
  AND a.alert_type = 'product_voicex_price_above_local'
  AND p.deleted_at IS NULL;
