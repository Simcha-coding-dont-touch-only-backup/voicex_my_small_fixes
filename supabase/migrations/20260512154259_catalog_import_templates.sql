-- Stores reusable column-mapping templates for the spreadsheet
-- product import flow on the admin Products page. Templates are
-- global (visible/usable by every admin) and uniquely named.

CREATE TABLE catalog_import_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  mapping JSONB NOT NULL,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_catalog_import_templates_name_lower
  ON catalog_import_templates (LOWER(name));

CREATE INDEX idx_catalog_import_templates_created_by
  ON catalog_import_templates (created_by);

CREATE TRIGGER trg_catalog_import_templates_updated_at
  BEFORE UPDATE ON catalog_import_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
