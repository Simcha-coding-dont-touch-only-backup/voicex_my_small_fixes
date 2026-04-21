-- Add option #5 in the cart menu to empty the entire cart, with a confirmation step.
-- Flow:
--   cart_menu (#5 -> empty_cart) -> cart_empty_confirm
--   cart_empty_confirm (1) -> main_menu (after deleting all cart items)
--   cart_empty_confirm (2) -> cart_menu

DO $$
DECLARE
  v_version_id UUID;
  n_cart_menu UUID;
  n_main_menu UUID;
  n_cart_empty_confirm UUID;
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

SELECT id INTO n_cart_menu
FROM ivr_nodes
WHERE flow_version_id = v_version_id AND node_key = 'cart_menu';

SELECT id INTO n_main_menu
FROM ivr_nodes
WHERE flow_version_id = v_version_id AND node_key = 'main_menu';

-- ============================================================
-- NEW NODE
-- ============================================================

INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'cart_empty_confirm', 'input', 'cart_empty_confirm',
  'Are you sure you want to remove all the items currently found in your cart? Press 1 to move ahead. Press 2 to cancel.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  700, 600)
RETURNING id INTO n_cart_empty_confirm;

-- ============================================================
-- UPDATE cart_menu PROMPT + INTENTS to include option 5 (empty cart)
-- ============================================================

UPDATE ivr_nodes
SET prompt_text = 'Press 1 to hear all items. Press 2 to checkout. Press 3 to change an item. Press 4 to remove an item. Press 5 to empty your entire cart. Press star for Main Menu.',
    config = '{"input_type":"dtmf","timeout_seconds":10,"intents":[{"name":"list_items","dtmf_key":"1","speech_phrases":[],"target_node_key":"cart_list"},{"name":"checkout","dtmf_key":"2","speech_phrases":[],"target_node_key":"checkout_address_choice"},{"name":"change_item","dtmf_key":"3","speech_phrases":[],"target_node_key":"cart_change_id"},{"name":"remove_item","dtmf_key":"4","speech_phrases":[],"target_node_key":"cart_remove_id"},{"name":"empty_cart","dtmf_key":"5","speech_phrases":[],"target_node_key":"cart_empty_confirm"},{"name":"main_menu","dtmf_key":"*","speech_phrases":[],"target_node_key":"main_menu"}]}'::jsonb
WHERE id = n_cart_menu;

-- ============================================================
-- EDGES
-- ============================================================

-- cart_menu -> cart_empty_confirm (intent: empty_cart)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_menu, n_cart_empty_confirm, 'intent', 'empty_cart', 4);

-- Bump main_menu intent priority on cart_menu so it sits after empty_cart
UPDATE ivr_edges
SET priority = 5
WHERE flow_version_id = v_version_id
  AND source_node_id = n_cart_menu
  AND condition_type = 'intent'
  AND condition_value = 'main_menu';

-- cart_empty_confirm -> main_menu (confirmed: cart was emptied)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_empty_confirm, n_main_menu, 'match', 'confirmed', 0);

-- cart_empty_confirm -> cart_menu (cancelled)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_empty_confirm, n_cart_menu, 'match', 'cancelled', 1);

END $$;
