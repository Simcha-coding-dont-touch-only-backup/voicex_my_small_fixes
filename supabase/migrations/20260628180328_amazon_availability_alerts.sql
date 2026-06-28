-- Persist Amazon availability from Rainforest sync on catalog products.
ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS amazon_availability_status TEXT
  CHECK (
    amazon_availability_status IS NULL
    OR amazon_availability_status IN ('in_stock', 'out_of_stock', 'unknown', 'asin_not_found')
  );

COMMENT ON COLUMN public.catalog_products.amazon_availability_status IS
  'Last Rainforest sync availability: in_stock, out_of_stock, unknown, asin_not_found; NULL = never synced';

-- Extend product_history for availability transitions.
ALTER TABLE public.product_history
  DROP CONSTRAINT IF EXISTS product_history_change_type_check;

ALTER TABLE public.product_history
  ADD CONSTRAINT product_history_change_type_check
  CHECK (change_type IN ('price', 'status', 'amazon_availability'));

-- Distinguish out_of_stock vs asin_not_found in Product Sync report items.
ALTER TABLE public.product_sync_run_items
  ADD COLUMN IF NOT EXISTS unavailable_reason TEXT
  CHECK (
    unavailable_reason IS NULL
    OR unavailable_reason IN ('out_of_stock', 'asin_not_found')
  );

COMMENT ON COLUMN public.product_sync_run_items.unavailable_reason IS
  'Why the product was flagged unavailable during sync (out_of_stock or asin_not_found).';
