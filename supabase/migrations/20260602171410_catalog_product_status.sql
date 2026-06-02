ALTER TABLE catalog_products
  ADD COLUMN status TEXT;

UPDATE catalog_products
  SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END;

ALTER TABLE catalog_products
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT catalog_products_status_check
    CHECK (status IN ('active', 'inactive', 'frozen'));

DROP INDEX IF EXISTS idx_catalog_products_active;
ALTER TABLE catalog_products DROP COLUMN is_active;

CREATE INDEX idx_catalog_products_status ON catalog_products (status);

ALTER TABLE catalog_products
  ALTER COLUMN status SET DEFAULT 'active';
