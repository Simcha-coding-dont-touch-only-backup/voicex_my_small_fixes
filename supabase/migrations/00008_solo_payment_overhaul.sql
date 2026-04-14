-- Migration: Switch from Stripe to Sola Payments
-- 1. Rename stripe_token -> sola_token in payment_methods
-- 2. Add order_holds table for Sola auth hold tracking
-- 3. Add IVR nodes for DTMF card entry flow

-- ============================================================
-- PAYMENT METHODS: stripe_token -> sola_token
-- ============================================================

ALTER TABLE payment_methods RENAME COLUMN stripe_token TO sola_token;

-- ============================================================
-- ORDER HOLDS: track Sola auth-hold per order
-- ============================================================

CREATE TABLE order_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  sola_ref_num TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'captured', 'voided', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_holds_order ON order_holds (order_id);
CREATE INDEX idx_order_holds_status ON order_holds (status);

CREATE TRIGGER trg_order_holds_updated_at BEFORE UPDATE ON order_holds FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- IVR NODES: card entry flow
-- ============================================================

DO $$
DECLARE
  v_version_id UUID;
  n_checkout_payment_choice UUID;
  n_checkout_summary UUID;
  -- New nodes
  n_checkout_payment_select UUID;
  n_checkout_card_number UUID;
  n_checkout_card_exp UUID;
  n_checkout_card_cvv UUID;
  n_checkout_card_zip UUID;
  n_checkout_card_confirm UUID;
BEGIN

SELECT fv.id INTO v_version_id
FROM ivr_flow_versions fv
JOIN ivr_flows f ON f.id = fv.flow_id
WHERE f.is_active = TRUE AND fv.status = 'published'
LIMIT 1;

IF v_version_id IS NULL THEN
  RAISE NOTICE 'No active published flow version found, skipping';
  RETURN;
END IF;

SELECT id INTO n_checkout_payment_choice FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'checkout_payment_choice';
SELECT id INTO n_checkout_summary FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'checkout_summary';

-- Payment select (saved card selection routing)
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_payment_select', 'action', 'payment_select',
  'Select a saved card or enter a new one.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  500, 1550)
RETURNING id INTO n_checkout_payment_select;

-- Card number entry
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_card_number', 'input', 'card_number',
  'Please enter your credit card number followed by the pound key.',
  '{"input_type":"dtmf","timeout_seconds":15,"finish_on_key":"#"}',
  500, 1650)
RETURNING id INTO n_checkout_card_number;

-- Card expiration entry
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_card_exp', 'input', 'card_exp',
  'Enter the expiration date as 4 digits, month then year.',
  '{"input_type":"dtmf","num_digits":4,"timeout_seconds":10}',
  500, 1750)
RETURNING id INTO n_checkout_card_exp;

-- Card CVV entry
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_card_cvv', 'input', 'card_cvv',
  'Enter the 3 or 4 digit security code from your card, followed by the pound key.',
  '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}',
  500, 1850)
RETURNING id INTO n_checkout_card_cvv;

-- Card billing ZIP entry
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_card_zip', 'input', 'card_zip',
  'Enter your billing ZIP code.',
  '{"input_type":"dtmf","num_digits":5,"timeout_seconds":10}',
  500, 1950)
RETURNING id INTO n_checkout_card_zip;

-- Card confirmation
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_card_confirm', 'input', 'card_confirm',
  'Press 1 to confirm your card, or press 2 to re-enter.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  500, 2050)
RETURNING id INTO n_checkout_card_confirm;

-- ============================================================
-- EDGES
-- ============================================================

-- payment_choice -> payment_select (has saved cards)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_payment_choice, n_checkout_payment_select, 'match', 'has_cards', 0);

-- payment_choice -> card_number (no saved cards)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_payment_choice, n_checkout_card_number, 'match', 'new_card', 1);

-- payment_select -> checkout_summary (saved card selected)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_payment_select, n_checkout_summary, 'match', 'card_selected', 0);

-- payment_select -> card_number (enter new card)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_payment_select, n_checkout_card_number, 'match', 'new_card', 1);

-- card_number -> card_exp
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_card_number, n_checkout_card_exp, 'default', NULL, 0);

-- card_exp -> card_cvv
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_card_exp, n_checkout_card_cvv, 'default', NULL, 0);

-- card_cvv -> card_zip
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_card_cvv, n_checkout_card_zip, 'default', NULL, 0);

-- card_zip -> card_confirm
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_card_zip, n_checkout_card_confirm, 'default', NULL, 0);

-- card_confirm -> checkout_summary (card saved)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_card_confirm, n_checkout_summary, 'match', 'confirmed', 0);

-- card_confirm -> card_number (re-enter)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_card_confirm, n_checkout_card_number, 'match', 'retry', 1);

END $$;
