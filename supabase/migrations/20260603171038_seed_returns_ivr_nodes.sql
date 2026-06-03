-- Returns IVR flow: adds the returns menu and all sub-step nodes, repoints the
-- main-menu option 4 from the old self-loop to the new returns_menu, and adds
-- edges so the IVR management graph stays coherent. Runtime routing for the
-- handler-driven nodes is done in returns-handlers.ts via explicit node_key.
DO $$
DECLARE
  v_version_id UUID;
  n_main_menu UUID;
  n_returns_menu UUID;
  n_order_entry UUID;
  n_recent_list UUID;
  n_single_confirm UUID;
  n_single_qty_choice UUID;
  n_qty_entry UUID;
  n_qty_confirm UUID;
  n_multi_choice UUID;
  n_multi_method UUID;
  n_product_entry UUID;
  n_product_list UUID;
  n_product_confirm UUID;
  n_product_qty_choice UUID;
  n_product_added UUID;
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

SELECT id INTO n_main_menu FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'main_menu';

-- ============================================================
-- NODES
-- ============================================================

-- [01] Returns menu
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_menu', 'menu', NULL,
  'Returns. If you know your VoiceX order number, press 1. To hear a list of your recent orders, press 2. Press star to go back.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":8,"intents":[{"name":"known_order","dtmf_key":"1","speech_phrases":[],"target_node_key":"returns_order_entry"},{"name":"recent_orders","dtmf_key":"2","speech_phrases":[],"target_node_key":"returns_recent_list"}]}',
  1200, 300)
RETURNING id INTO n_returns_menu;

-- [02] Enter order number
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_order_entry', 'input', 'returns_order_entry',
  'Please enter your 5 digit VoiceX order number.',
  '{"input_type":"dtmf","num_digits":5,"timeout_seconds":10,"finish_on_key":""}',
  1050, 450)
RETURNING id INTO n_order_entry;

-- Hear a list of recent orders, then select
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_recent_list', 'action', 'returns_recent_list',
  'Listing your recent orders.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":12}',
  1350, 450)
RETURNING id INTO n_recent_list;

-- [04] single product, single qty -> confirm
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_single_confirm', 'action', 'returns_single_confirm',
  'Press 1 to confirm that you would like to return the entire order.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  900, 600)
RETURNING id INTO n_single_confirm;

-- [06] single product, multiple qty -> all or partial
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_single_qty_choice', 'action', 'returns_single_qty_choice',
  'To return all, press 1. To return a partial quantity, press 2.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  1050, 600)
RETURNING id INTO n_single_qty_choice;

-- [07] enter partial quantity
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_qty_entry', 'input', 'returns_qty_entry',
  'Enter the quantity you would like to return, then press pound.',
  '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}',
  1050, 750)
RETURNING id INTO n_qty_entry;

-- [18] confirm partial quantity
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_qty_confirm', 'action', 'returns_qty_confirm',
  'Press 1 to confirm the quantity you would like to return.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  1050, 900)
RETURNING id INTO n_qty_confirm;

-- [08] multiple products: entire order or specific products
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_multi_choice', 'action', 'returns_multi_choice',
  'To return your entire order, press 1. To return specific products, press 2.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  1350, 600)
RETURNING id INTO n_multi_choice;

-- [09] choose VoiceX-ID entry or hear product list
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_multi_method', 'menu', NULL,
  'If you know the VoiceX IDs of the products you would like to return, press 1. To hear a list of all the products that were included in the order, press 2. Press star to go back.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10,"intents":[{"name":"known_ids","dtmf_key":"1","speech_phrases":[],"target_node_key":"returns_product_entry"},{"name":"hear_list","dtmf_key":"2","speech_phrases":[],"target_node_key":"returns_product_list"}]}',
  1350, 750)
RETURNING id INTO n_multi_method;

-- [10] enter VoiceX ID
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_product_entry', 'input', 'returns_product_entry',
  'Enter the VoiceX ID of the product you would like to return, then press pound.',
  '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}',
  1200, 900)
RETURNING id INTO n_product_entry;

-- [14] hear list of products, select by number
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_product_list', 'action', 'returns_product_list',
  'Listing the products in your order. Press a product number followed by pound.',
  '{"input_type":"dtmf","timeout_seconds":3,"finish_on_key":"#"}',
  1500, 900)
RETURNING id INTO n_product_list;

-- [11] confirm single-qty product
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_product_confirm', 'action', 'returns_product_confirm',
  'Press 1 to confirm that you would like to return this product.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  1350, 1050)
RETURNING id INTO n_product_confirm;

-- [13] product with multiple qty: all or partial
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_product_qty_choice', 'action', 'returns_product_qty_choice',
  'To return all, press 1. To return a partial quantity, press 2.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  1500, 1050)
RETURNING id INTO n_product_qty_choice;

-- [12] product added: continue or finalize
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'returns_product_added', 'action', 'returns_product_added',
  'Confirmed. To return another product, press 1. To finalize your return, press 2.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  1350, 1200)
RETURNING id INTO n_product_added;

-- ============================================================
-- MAIN MENU: enable option 4 (Returns)
-- ============================================================
UPDATE ivr_nodes
SET prompt_text = 'Main Menu. Press 1 for Catalog to browse products. Press 2 for Cart to view your cart. Press 3 for Orders to check order status. Press 4 for Returns.',
    config = jsonb_set(
      config,
      '{intents}',
      (
        SELECT jsonb_agg(
          CASE WHEN i->>'name' = 'returns'
               THEN jsonb_set(i, '{target_node_key}', '"returns_menu"')
               ELSE i END
        )
        FROM jsonb_array_elements(config->'intents') AS i
      )
    )
WHERE id = n_main_menu;

-- ============================================================
-- EDGES (graph editor coherence)
-- ============================================================
-- Repoint the old main_menu -> main_menu 'returns' self-loop.
DELETE FROM ivr_edges
WHERE flow_version_id = v_version_id
  AND source_node_id = n_main_menu
  AND target_node_id = n_main_menu
  AND condition_type = 'intent'
  AND condition_value = 'returns';

INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority) VALUES
  (v_version_id, n_main_menu, n_returns_menu, 'intent', 'returns', 3),
  (v_version_id, n_returns_menu, n_order_entry, 'intent', 'known_order', 0),
  (v_version_id, n_returns_menu, n_recent_list, 'intent', 'recent_orders', 1),
  (v_version_id, n_multi_method, n_product_entry, 'intent', 'known_ids', 0),
  (v_version_id, n_multi_method, n_product_list, 'intent', 'hear_list', 1),
  (v_version_id, n_order_entry, n_single_confirm, 'match', 'single_one', 0),
  (v_version_id, n_order_entry, n_single_qty_choice, 'match', 'single_multi', 1),
  (v_version_id, n_order_entry, n_multi_choice, 'match', 'multi', 2),
  (v_version_id, n_recent_list, n_multi_choice, 'match', 'select', 0),
  (v_version_id, n_single_qty_choice, n_qty_entry, 'match', 'partial', 0),
  (v_version_id, n_qty_entry, n_qty_confirm, 'match', 'next', 0),
  (v_version_id, n_qty_confirm, n_product_added, 'match', 'multi_added', 0),
  (v_version_id, n_multi_choice, n_multi_method, 'match', 'specific', 0),
  (v_version_id, n_product_entry, n_product_confirm, 'match', 'single', 0),
  (v_version_id, n_product_entry, n_product_qty_choice, 'match', 'multi_qty', 1),
  (v_version_id, n_product_list, n_product_confirm, 'match', 'single', 0),
  (v_version_id, n_product_qty_choice, n_qty_entry, 'match', 'partial', 0),
  (v_version_id, n_product_qty_choice, n_product_added, 'match', 'all', 1),
  (v_version_id, n_product_confirm, n_product_added, 'match', 'confirmed', 0),
  (v_version_id, n_product_added, n_product_entry, 'match', 'another', 0);

END $$;
