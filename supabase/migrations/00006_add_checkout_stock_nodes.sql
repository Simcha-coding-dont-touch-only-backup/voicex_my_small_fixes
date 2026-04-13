-- Add new IVR nodes for multi-item checkout with stock validation:
--   checkout_final_confirm, checkout_stock_issue, checkout_stock_new_qty, checkout_pay
-- These nodes connect to handlers: final_confirm, stock_issue, stock_new_qty, checkout_pay

DO $$
DECLARE
  v_version_id UUID;
  -- Existing nodes we need to reference for edges
  n_checkout_confirm UUID;
  n_main_menu UUID;
  n_cart_menu UUID;
  -- New nodes
  n_checkout_final_confirm UUID;
  n_checkout_stock_issue UUID;
  n_checkout_stock_new_qty UUID;
  n_checkout_pay UUID;
BEGIN

-- Get the published flow version
SELECT fv.id INTO v_version_id
FROM ivr_flow_versions fv
JOIN ivr_flows f ON f.id = fv.flow_id
WHERE f.is_active = TRUE AND fv.status = 'published'
LIMIT 1;

IF v_version_id IS NULL THEN
  RAISE NOTICE 'No active published flow version found, skipping';
  RETURN;
END IF;

-- Get existing node IDs we need for edges
SELECT id INTO n_checkout_confirm FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'checkout_confirm';
SELECT id INTO n_main_menu FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'main_menu';
SELECT id INTO n_cart_menu FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'cart_menu';

-- ============================================================
-- NEW NODES
-- ============================================================

-- Checkout: final confirm (creates Rye intent, checks stock, shows real total)
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_final_confirm', 'action', 'final_confirm',
  'Verifying your order with Amazon.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":30}',
  700, 1950)
RETURNING id INTO n_checkout_final_confirm;

-- Checkout: stock issue (walks caller through each failed item)
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_stock_issue', 'action', 'stock_issue',
  'Resolving stock issue.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":15}',
  850, 1950)
RETURNING id INTO n_checkout_stock_issue;

-- Checkout: stock new qty (user enters new quantity for insufficient stock item)
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_stock_new_qty', 'input', 'stock_new_qty',
  'Enter the new quantity or press 2 to remove.',
  '{"input_type":"dtmf","timeout_seconds":15,"finish_on_key":"#"}',
  850, 2100)
RETURNING id INTO n_checkout_stock_new_qty;

-- Checkout: pay (user confirmed total, insert order and confirm with Rye)
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_pay', 'action', 'checkout_pay',
  'Processing your payment.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":15}',
  700, 2100)
RETURNING id INTO n_checkout_pay;

-- ============================================================
-- EDGES
-- ============================================================

-- checkout_confirm -> checkout_final_confirm (replaces old confirm -> main_menu success edge)
-- Remove old edge: confirm -> main_menu for 'confirmed'
DELETE FROM ivr_edges
WHERE flow_version_id = v_version_id
  AND source_node_id = n_checkout_confirm
  AND target_node_id = n_main_menu
  AND condition_value = 'confirmed';

-- confirm -> final_confirm (confirmed)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_confirm, n_checkout_final_confirm, 'match', 'confirmed', 0);

-- final_confirm -> checkout_pay (stock OK, user sees total)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_final_confirm, n_checkout_pay, 'match', 'stock_ok', 0);

-- final_confirm -> stock_issue (stock problem)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_final_confirm, n_checkout_stock_issue, 'match', 'stock_failed', 1);

-- final_confirm -> cart_menu (cancelled)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_final_confirm, n_cart_menu, 'match', 'cancelled', 2);

-- stock_issue -> stock_new_qty (insufficient stock, user wants to change qty)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_stock_issue, n_checkout_stock_new_qty, 'match', 'change_qty', 0);

-- stock_issue -> final_confirm (all issues resolved, retry intent)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_stock_issue, n_checkout_final_confirm, 'match', 'retry', 1);

-- stock_issue -> main_menu (cart empty after removals)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_stock_issue, n_main_menu, 'match', 'empty_cart', 2);

-- stock_new_qty -> stock_issue (qty updated, advance to next issue)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_stock_new_qty, n_checkout_stock_issue, 'default', NULL, 0);

-- checkout_pay -> main_menu (order placed successfully)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_pay, n_main_menu, 'match', 'confirmed', 0);

-- checkout_pay -> cart_menu (cancelled)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_pay, n_cart_menu, 'match', 'cancelled', 1);

END $$;
