ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS frozen_source TEXT
  CHECK (frozen_source IS NULL OR frozen_source IN ('auto', 'manual'));

-- Backfill auto-freeze only for products that still exceed local retail and have a
-- non-resolved price alert (matches syncProductCatalogAlerts / applyAutoFreezeState).
WITH markup AS (
  SELECT COALESCE(
    (SELECT NULLIF(TRIM(value), '')::numeric
     FROM public.settings
     WHERE key = 'default_markup_percent'
     LIMIT 1),
    15::numeric
  ) AS pct
),
effective AS (
  SELECT
    p.id AS product_id,
    CASE
      WHEN p.custom_price_cents IS NOT NULL THEN p.custom_price_cents::bigint
      WHEN p.amazon_price_cents IS NOT NULL
        THEN ROUND(p.amazon_price_cents::numeric * (1 + m.pct / 100))::bigint
      ELSE NULL
    END AS effective_custom_price_cents,
    p.local_price_cents
  FROM public.catalog_products p
  CROSS JOIN markup m
  WHERE p.deleted_at IS NULL
)
UPDATE catalog_products p
SET status = 'frozen',
    frozen_source = 'auto',
    updated_at = now()
FROM admin_alerts a
JOIN effective e ON e.product_id = p.id
WHERE a.product_id = p.id
  AND a.alert_type = 'product_voicex_price_above_local'
  AND a.status <> 'resolved'
  AND p.deleted_at IS NULL
  AND p.status = 'active'
  AND e.local_price_cents IS NOT NULL
  AND e.effective_custom_price_cents IS NOT NULL
  AND e.effective_custom_price_cents > e.local_price_cents;
