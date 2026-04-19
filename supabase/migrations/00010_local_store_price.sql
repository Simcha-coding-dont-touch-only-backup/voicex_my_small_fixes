-- Optional local retail store price per product; snapshot on cart/order lines for stable savings messaging.

ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS local_price_cents INTEGER;
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS local_price_cents INTEGER;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS local_price_cents INTEGER;
