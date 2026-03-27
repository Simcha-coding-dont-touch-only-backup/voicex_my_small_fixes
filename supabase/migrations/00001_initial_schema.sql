-- VoiceX MVP Initial Schema
-- All tables use UUID primary keys via gen_random_uuid()

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'deleted')),
  is_whitelisted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_status ON users (status);
CREATE INDEX idx_users_email ON users (email) WHERE email IS NOT NULL;

CREATE TABLE user_phones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_user_phones_number ON user_phones (phone_number);
CREATE INDEX idx_user_phones_user ON user_phones (user_id);

CREATE TABLE user_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE login_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_events_user ON login_events (user_id);
CREATE INDEX idx_login_events_created ON login_events (created_at);

-- ============================================================
-- ADDRESSES
-- ============================================================

CREATE TABLE addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  address1 TEXT NOT NULL,
  address2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_validated BOOLEAN NOT NULL DEFAULT FALSE,
  google_place_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_addresses_user ON addresses (user_id);

-- ============================================================
-- PAYMENT METHODS
-- ============================================================

CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_token TEXT NOT NULL,
  card_last4 TEXT NOT NULL,
  card_brand TEXT,
  card_exp_month INTEGER NOT NULL DEFAULT 0,
  card_exp_year INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_methods_user ON payment_methods (user_id);

-- ============================================================
-- CATALOG
-- ============================================================

CREATE TABLE catalog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES catalog_categories(id) ON DELETE SET NULL,
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth <= 2),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_catalog_categories_parent ON catalog_categories (parent_id);

CREATE TABLE catalog_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voicex_id TEXT NOT NULL UNIQUE,
  amazon_asin TEXT NOT NULL,
  amazon_url TEXT NOT NULL,
  amazon_name TEXT,
  amazon_description TEXT,
  amazon_price_cents INTEGER,
  voice_name TEXT,
  voice_description TEXT,
  custom_price_cents INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  lifetime_qty_sold INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_catalog_products_voicex_id ON catalog_products (voicex_id);
CREATE INDEX idx_catalog_products_asin ON catalog_products (amazon_asin);
CREATE INDEX idx_catalog_products_active ON catalog_products (is_active);

CREATE TABLE catalog_product_categories (
  product_id UUID NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES catalog_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

CREATE INDEX idx_product_categories_category ON catalog_product_categories (category_id);

-- ============================================================
-- CARTS
-- ============================================================

CREATE TABLE carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checked_out', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_carts_user_status ON carts (user_id, status);

CREATE TABLE cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES catalog_products(id),
  voicex_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL,
  amazon_price_cents INTEGER NOT NULL,
  markup_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cart_items_cart ON cart_items (cart_id);
CREATE UNIQUE INDEX idx_cart_items_cart_product ON cart_items (cart_id, product_id);

-- ============================================================
-- ORDERS
-- ============================================================

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  cart_id UUID REFERENCES carts(id),
  address_id UUID REFERENCES addresses(id),
  payment_method_id UUID REFERENCES payment_methods(id),
  rye_checkout_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','awaiting_confirmation','confirmed','completed','failed','cancelled')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  estimated_delivery TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user ON orders (user_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_created ON orders (created_at);
CREATE INDEX idx_orders_rye_intent ON orders (rye_checkout_intent_id) WHERE rye_checkout_intent_id IS NOT NULL;

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES catalog_products(id),
  voicex_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  amazon_price_cents INTEGER NOT NULL,
  markup_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_product ON order_items (product_id);

CREATE TABLE order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'rye_webhook', 'admin')),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_events_order ON order_events (order_id);
CREATE INDEX idx_order_events_created ON order_events (created_at);

-- ============================================================
-- IVR FLOWS
-- ============================================================

CREATE TABLE ivr_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ivr_flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES ivr_flows(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ivr_flow_versions_flow ON ivr_flow_versions (flow_id);
CREATE INDEX idx_ivr_flow_versions_status ON ivr_flow_versions (status);

CREATE TABLE ivr_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_version_id UUID NOT NULL REFERENCES ivr_flow_versions(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN ('entry','menu','input','action','branch','transfer','hangup','submenu')),
  handler_name TEXT,
  prompt_text TEXT,
  prompt_ssml TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ivr_nodes_version ON ivr_nodes (flow_version_id);
CREATE UNIQUE INDEX idx_ivr_nodes_version_key ON ivr_nodes (flow_version_id, node_key);

CREATE TABLE ivr_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_version_id UUID NOT NULL REFERENCES ivr_flow_versions(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES ivr_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES ivr_nodes(id) ON DELETE CASCADE,
  condition_type TEXT NOT NULL DEFAULT 'default' CHECK (condition_type IN ('intent','default','timeout','error','match')),
  condition_value TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ivr_edges_version ON ivr_edges (flow_version_id);
CREATE INDEX idx_ivr_edges_source ON ivr_edges (source_node_id);

CREATE TABLE ivr_prompt_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES ivr_nodes(id) ON DELETE CASCADE,
  variant_key TEXT NOT NULL,
  text TEXT NOT NULL,
  ssml TEXT,
  language TEXT NOT NULL DEFAULT 'en-US',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ivr_prompt_variants_node ON ivr_prompt_variants (node_id);

-- ============================================================
-- CALL SESSIONS
-- ============================================================

CREATE TABLE call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id),
  phone_number TEXT NOT NULL,
  flow_version_id UUID REFERENCES ivr_flow_versions(id),
  current_node_key TEXT NOT NULL DEFAULT 'entry',
  state_data JSONB NOT NULL DEFAULT '{}',
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_sessions_sid ON call_sessions (call_sid);
CREATE INDEX idx_call_sessions_user ON call_sessions (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_call_sessions_active ON call_sessions (ended_at) WHERE ended_at IS NULL;

-- ============================================================
-- SETTINGS
-- ============================================================

CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ADMIN
-- ============================================================

CREATE TABLE admin_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_logs_admin ON admin_audit_logs (admin_user_id);
CREATE INDEX idx_admin_audit_logs_entity ON admin_audit_logs (entity_type, entity_id);
CREATE INDEX idx_admin_audit_logs_created ON admin_audit_logs (created_at);

-- ============================================================
-- FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION increment_product_sold(p_product_id UUID, p_qty INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE catalog_products
  SET lifetime_qty_sold = lifetime_qty_sold + p_qty,
      updated_at = now()
  WHERE id = p_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_addresses_updated_at BEFORE UPDATE ON addresses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_payment_methods_updated_at BEFORE UPDATE ON payment_methods FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_catalog_categories_updated_at BEFORE UPDATE ON catalog_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_catalog_products_updated_at BEFORE UPDATE ON catalog_products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_carts_updated_at BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_cart_items_updated_at BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_call_sessions_updated_at BEFORE UPDATE ON call_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO settings (key, value, description) VALUES
  ('default_markup_percent', '15', 'Default markup percentage applied to Amazon base prices'),
  ('max_cart_items', '50', 'Maximum number of distinct items allowed in a cart'),
  ('call_timeout_seconds', '30', 'Default timeout for IVR input steps'),
  ('max_pin_retries', '3', 'Maximum PIN entry attempts before call termination');
