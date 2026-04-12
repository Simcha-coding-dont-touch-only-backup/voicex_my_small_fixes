ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS amazon_star_rating NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS amazon_ratings_total INTEGER;
