-- Per-product custom markup percentage.
-- When `custom_price_cents` is null and this is set, the product's VoiceX price is
-- `amazon_price_cents * (1 + custom_markup_percent/100)` — overriding the global
-- `default_markup_percent` setting. Null = fall back to the global default.
ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS custom_markup_percent NUMERIC;

COMMENT ON COLUMN catalog_products.custom_markup_percent IS
  'Per-product markup %% applied to Amazon price when custom_price_cents is null; overrides default_markup_percent. Null = use global default.';
