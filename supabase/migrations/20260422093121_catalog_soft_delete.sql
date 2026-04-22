-- Soft delete for catalog products and categories
--
-- Sub-admins (role = 'sub_admin') only do soft deletes on
-- catalog_products / catalog_categories — rows get deleted_at + deleted_by
-- set instead of being removed. The super admin uses dedicated trash pages
-- to restore or permanently delete those rows.
--
-- Super admins continue to hard-delete from the regular product/category
-- pages, so the new columns are also useful as an audit trail of who
-- trashed what before a restore.

ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;

ALTER TABLE catalog_categories
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;

-- Partial indexes — most reads filter to the live (non-deleted) set, so
-- the indexes only need to cover those rows. Cheaper to maintain and
-- smaller on disk than full indexes.
CREATE INDEX IF NOT EXISTS catalog_products_active_idx
  ON catalog_products (created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS catalog_categories_active_idx
  ON catalog_categories (sort_order)
  WHERE deleted_at IS NULL;

-- Trash page reads filter to the deleted set.
CREATE INDEX IF NOT EXISTS catalog_products_deleted_idx
  ON catalog_products (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_categories_deleted_idx
  ON catalog_categories (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;
