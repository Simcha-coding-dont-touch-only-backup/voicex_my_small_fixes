-- Undo incorrect auto-freeze from catalog_products_frozen_source backfill:
-- products frozen solely because a resolved price-above-local alert row still existed.
WITH markup AS (
  SELECT COALESCE(
    (SELECT NULLIF(TRIM(value), '')::numeric
     FROM public.settings
     WHERE key = 'default_markup_percent'
     LIMIT 1),
    15::numeric
  ) AS pct
),
pricing AS (
  SELECT
    p.id,
    (
      p.amazon_price_cents IS NULL
      OR (
        p.local_price_cents IS NOT NULL
        AND (
          CASE
            WHEN p.custom_price_cents IS NOT NULL THEN p.custom_price_cents::bigint
            WHEN p.amazon_price_cents IS NOT NULL
              THEN ROUND(p.amazon_price_cents::numeric * (1 + m.pct / 100))::bigint
            ELSE NULL
          END
        ) > p.local_price_cents
      )
    ) AS should_freeze
  FROM public.catalog_products p
  CROSS JOIN markup m
  WHERE p.deleted_at IS NULL
)
UPDATE public.catalog_products p
SET status = 'active',
    frozen_source = NULL,
    updated_at = now()
FROM public.admin_alerts a
JOIN pricing pr ON pr.id = a.product_id
WHERE p.id = a.product_id
  AND a.alert_type = 'product_voicex_price_above_local'
  AND a.status = 'resolved'
  AND p.status = 'frozen'
  AND p.frozen_source = 'auto'
  AND p.deleted_at IS NULL
  AND NOT pr.should_freeze;
