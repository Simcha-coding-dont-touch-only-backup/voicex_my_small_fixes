-- Sort key matches admin list: trimmed voice_name when set, else trimmed amazon_name, else voicex_id.
ALTER TABLE catalog_products
ADD COLUMN IF NOT EXISTS name_sort_key text
GENERATED ALWAYS AS (
  COALESCE(
    NULLIF(BTRIM(voice_name), ''),
    NULLIF(BTRIM(amazon_name), ''),
    voicex_id
  )
) STORED;

CREATE INDEX IF NOT EXISTS idx_catalog_products_name_sort_key ON catalog_products (name_sort_key);
