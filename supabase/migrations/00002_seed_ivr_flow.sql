-- Seed the default IVR flow with all nodes and edges
-- representing the current hardcoded flow logic

DO $$
DECLARE
  v_flow_id UUID;
  v_version_id UUID;
  -- Node IDs
  n_entry UUID;
  n_frozen_hangup UUID;
  n_deleted_hangup UUID;
  n_error_hangup UUID;
  n_pin_entry UUID;
  n_register_name UUID;
  n_register_name_confirm UUID;
  n_register_pin UUID;
  n_register_pin_confirm UUID;
  n_main_menu UUID;
  n_catalog_input UUID;
  n_catalog_action UUID;
  n_catalog_qty UUID;
  n_catalog_qty_confirm UUID;
  n_catalog_after_add UUID;
  n_cart_menu UUID;
  n_cart_list UUID;
  n_cart_change_id UUID;
  n_cart_change_qty UUID;
  n_cart_change_confirm UUID;
  n_cart_remove_id UUID;
  n_cart_remove_confirm UUID;
  n_checkout_address_choice UUID;
  n_checkout_address_line1 UUID;
  n_checkout_address_line2 UUID;
  n_checkout_address_city UUID;
  n_checkout_address_state UUID;
  n_checkout_address_zip UUID;
  n_checkout_address_confirm UUID;
  n_checkout_payment_choice UUID;
  n_checkout_summary UUID;
  n_checkout_confirm UUID;
  n_orders_list UUID;
  n_orders_detail UUID;
BEGIN

-- Create flow
INSERT INTO ivr_flows (id, name, description, is_active)
VALUES (gen_random_uuid(), 'Main IVR Flow', 'Primary phone ordering flow for VoiceX', TRUE)
RETURNING id INTO v_flow_id;

-- Create published version
INSERT INTO ivr_flow_versions (id, flow_id, version_number, status, published_at)
VALUES (gen_random_uuid(), v_flow_id, 1, 'published', now())
RETURNING id INTO v_version_id;

-- ============================================================
-- NODES
-- ============================================================

-- Entry point
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'entry', 'entry', 'check_user', 'Incoming call entry point', '{}', 400, 0)
RETURNING id INTO n_entry;

-- Hangup nodes
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'frozen_hangup', 'hangup', NULL, 'Your account is currently restricted. Please contact support.', '{}', 100, 150)
RETURNING id INTO n_frozen_hangup;

INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'deleted_hangup', 'hangup', NULL, 'This account is no longer active. Please contact support.', '{}', 250, 150)
RETURNING id INTO n_deleted_hangup;

INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'error_hangup', 'hangup', NULL, 'We are experiencing technical difficulties. Please try again later.', '{}', 700, 150)
RETURNING id INTO n_error_hangup;

-- PIN entry
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'pin_entry', 'input', 'validate_pin',
  'Welcome back. Please enter your 4 digit PIN.',
  '{"input_type":"dtmf","num_digits":4,"timeout_seconds":10,"max_retries":3,"finish_on_key":""}',
  400, 150)
RETURNING id INTO n_pin_entry;

-- Registration: name
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'register_name', 'input', 'capture_name',
  'Welcome to VoiceX! It looks like you are a new caller. To create an account, please say your full name after the beep, then press pound.',
  '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}',
  550, 150)
RETURNING id INTO n_register_name;

-- Registration: name confirm
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'register_name_confirm', 'input', 'confirm_name',
  'Press 1 to confirm your name, or press 2 to re-enter.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  550, 300)
RETURNING id INTO n_register_name_confirm;

-- Registration: PIN
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'register_pin', 'input', 'capture_pin',
  'Please enter a 4 digit PIN that you will use to access your account.',
  '{"input_type":"dtmf","num_digits":4,"timeout_seconds":15,"finish_on_key":""}',
  550, 450)
RETURNING id INTO n_register_pin;

-- Registration: PIN confirm
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'register_pin_confirm', 'input', 'confirm_pin_register',
  'Press 1 to confirm, or press 2 to re-enter.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10,"finish_on_key":""}',
  550, 600)
RETURNING id INTO n_register_pin_confirm;

-- Main menu
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'main_menu', 'menu', NULL,
  'Main Menu. Press 1 for Catalog to browse products. Press 2 for Cart to view your cart. Press 3 for Orders to check order status.',
  '{"input_type":"dtmf","timeout_seconds":8,"intents":[{"name":"catalog","dtmf_key":"1","speech_phrases":[],"target_node_key":"catalog_input"},{"name":"cart","dtmf_key":"2","speech_phrases":[],"target_node_key":"cart_menu"},{"name":"orders","dtmf_key":"3","speech_phrases":[],"target_node_key":"orders_list"},{"name":"returns","dtmf_key":"4","speech_phrases":[],"target_node_key":"main_menu"}]}',
  400, 300)
RETURNING id INTO n_main_menu;

-- Catalog: input
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'catalog_input', 'input', 'lookup_product',
  'Please enter the catalog number for the product you would like to look up.',
  '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}',
  100, 450)
RETURNING id INTO n_catalog_input;

-- Catalog: action menu
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'catalog_action', 'menu', 'catalog_action',
  'Press 1 to Add to Cart. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product. Press star for Main Menu.',
  '{"input_type":"dtmf","timeout_seconds":10,"intents":[{"name":"add_to_cart","dtmf_key":"1","speech_phrases":[],"target_node_key":"catalog_qty"},{"name":"more_details","dtmf_key":"2","speech_phrases":[],"target_node_key":"catalog_action"},{"name":"reviews","dtmf_key":"3","speech_phrases":[],"target_node_key":"catalog_action"},{"name":"another","dtmf_key":"4","speech_phrases":[],"target_node_key":"catalog_input"},{"name":"main_menu","dtmf_key":"*","speech_phrases":[],"target_node_key":"main_menu"}]}',
  100, 600)
RETURNING id INTO n_catalog_action;

-- Catalog: quantity
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'catalog_qty', 'input', 'enter_qty',
  'How many would you like to add? Enter the quantity.',
  '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}',
  100, 750)
RETURNING id INTO n_catalog_qty;

-- Catalog: qty confirm
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'catalog_qty_confirm', 'input', 'confirm_qty',
  'Press 1 to confirm, or press 2 to re-enter.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10,"finish_on_key":""}',
  100, 900)
RETURNING id INTO n_catalog_qty_confirm;

-- Catalog: after add
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'catalog_after_add', 'menu', NULL,
  'Press 1 for Another Product. Press 2 for Checkout. Press star for Main Menu.',
  '{"input_type":"dtmf","timeout_seconds":8,"intents":[{"name":"another","dtmf_key":"1","speech_phrases":[],"target_node_key":"catalog_input"},{"name":"checkout","dtmf_key":"2","speech_phrases":[],"target_node_key":"cart_menu"},{"name":"main_menu","dtmf_key":"*","speech_phrases":[],"target_node_key":"main_menu"}]}',
  100, 1050)
RETURNING id INTO n_catalog_after_add;

-- Cart: menu
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'cart_menu', 'menu', 'cart_summary',
  'Press 1 to hear all items. Press 2 to checkout. Press 3 to change an item. Press 4 to remove an item. Press star for Main Menu.',
  '{"input_type":"dtmf","timeout_seconds":10,"intents":[{"name":"list_items","dtmf_key":"1","speech_phrases":[],"target_node_key":"cart_list"},{"name":"checkout","dtmf_key":"2","speech_phrases":[],"target_node_key":"checkout_address_choice"},{"name":"change_item","dtmf_key":"3","speech_phrases":[],"target_node_key":"cart_change_id"},{"name":"remove_item","dtmf_key":"4","speech_phrases":[],"target_node_key":"cart_remove_id"},{"name":"main_menu","dtmf_key":"*","speech_phrases":[],"target_node_key":"main_menu"}]}',
  400, 450)
RETURNING id INTO n_cart_menu;

-- Cart: list
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'cart_list', 'action', 'cart_list',
  'Reading cart items.',
  '{"input_type":"dtmf","timeout_seconds":10}',
  400, 600)
RETURNING id INTO n_cart_list;

-- Cart: change ID
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'cart_change_id', 'input', 'cart_change_id',
  'Enter the catalog number of the item you want to change.',
  '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}',
  250, 600)
RETURNING id INTO n_cart_change_id;

-- Cart: change qty
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'cart_change_qty', 'input', 'cart_change_qty',
  'Enter the new quantity.',
  '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}',
  250, 750)
RETURNING id INTO n_cart_change_qty;

-- Cart: change confirm
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'cart_change_confirm', 'input', 'cart_change_confirm',
  'Press 1 to confirm, or press 2 to re-enter.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  250, 900)
RETURNING id INTO n_cart_change_confirm;

-- Cart: remove ID
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'cart_remove_id', 'input', 'cart_remove_id',
  'Enter the catalog number of the item you want to remove.',
  '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}',
  550, 600)
RETURNING id INTO n_cart_remove_id;

-- Cart: remove confirm
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'cart_remove_confirm', 'input', 'cart_remove_confirm',
  'Press 1 to confirm removal, or press 2 to cancel.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  550, 750)
RETURNING id INTO n_cart_remove_confirm;

-- Checkout: address choice
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_address_choice', 'action', 'address_choice',
  'Checking for saved addresses.',
  '{"input_type":"dtmf","timeout_seconds":10}',
  700, 450)
RETURNING id INTO n_checkout_address_choice;

-- Checkout: address line1
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_address_line1', 'input', 'address_line1',
  'Please enter your street number and name followed by the pound key.',
  '{"input_type":"dtmf","timeout_seconds":15,"finish_on_key":"#"}',
  700, 600)
RETURNING id INTO n_checkout_address_line1;

-- Checkout: address line2
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_address_line2', 'input', 'address_line2',
  'Enter apartment or unit number, or press pound to skip.',
  '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}',
  700, 750)
RETURNING id INTO n_checkout_address_line2;

-- Checkout: address city
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_address_city', 'input', 'address_city',
  'Enter your city name followed by the pound key.',
  '{"input_type":"dtmf","timeout_seconds":15,"finish_on_key":"#"}',
  700, 900)
RETURNING id INTO n_checkout_address_city;

-- Checkout: address state
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_address_state', 'input', 'address_state',
  'Enter your 2-letter state code.',
  '{"input_type":"dtmf","timeout_seconds":10}',
  700, 1050)
RETURNING id INTO n_checkout_address_state;

-- Checkout: address zip
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_address_zip', 'input', 'address_zip',
  'Enter your 5-digit ZIP code.',
  '{"input_type":"dtmf","num_digits":5,"timeout_seconds":10,"finish_on_key":""}',
  700, 1200)
RETURNING id INTO n_checkout_address_zip;

-- Checkout: address confirm
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_address_confirm', 'input', 'address_confirm',
  'Press 1 to confirm, or press 2 to re-enter.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  700, 1350)
RETURNING id INTO n_checkout_address_confirm;

-- Checkout: payment choice
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_payment_choice', 'action', 'payment_choice',
  'Checking for saved payment methods.',
  '{"input_type":"dtmf","timeout_seconds":10}',
  700, 1500)
RETURNING id INTO n_checkout_payment_choice;

-- Checkout: summary
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_summary', 'action', 'order_summary',
  'Calculating your order total.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":15}',
  700, 1650)
RETURNING id INTO n_checkout_summary;

-- Checkout: confirm
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'checkout_confirm', 'action', 'order_confirm',
  'Press 1 to place the order, or press 2 to go back to your cart.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":15}',
  700, 1800)
RETURNING id INTO n_checkout_confirm;

-- Orders: list
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'orders_list', 'action', 'orders_list',
  'Loading your orders.',
  '{"input_type":"dtmf","timeout_seconds":10}',
  400, 750)
RETURNING id INTO n_orders_list;

-- Orders: detail
INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
VALUES (gen_random_uuid(), v_version_id, 'orders_detail', 'action', 'orders_detail',
  'Fetching order details.',
  '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}',
  400, 900)
RETURNING id INTO n_orders_detail;

-- ============================================================
-- EDGES
-- ============================================================

-- Entry -> PIN (existing user)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_entry, n_pin_entry, 'match', 'existing_user', 0);

-- Entry -> Register (new user)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_entry, n_register_name, 'match', 'new_user', 1);

-- Entry -> Frozen hangup
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_entry, n_frozen_hangup, 'match', 'frozen', 2);

-- Entry -> Deleted hangup
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_entry, n_deleted_hangup, 'match', 'deleted', 3);

-- Entry -> Error hangup
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_entry, n_error_hangup, 'error', NULL, 4);

-- PIN -> Main Menu (success)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_pin_entry, n_main_menu, 'match', 'success', 0);

-- PIN -> self (retry)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_pin_entry, n_pin_entry, 'match', 'retry', 1);

-- PIN -> Error hangup (max retries)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_pin_entry, n_error_hangup, 'match', 'max_retries', 2);

-- Register name -> name confirm
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_register_name, n_register_name_confirm, 'default', NULL, 0);

-- Register name confirm -> register PIN (confirmed)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_register_name_confirm, n_register_pin, 'match', 'confirmed', 0);

-- Register name confirm -> register name (retry)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_register_name_confirm, n_register_name, 'match', 'retry', 1);

-- Register PIN -> PIN confirm
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_register_pin, n_register_pin_confirm, 'default', NULL, 0);

-- Register PIN confirm -> main menu (confirmed)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_register_pin_confirm, n_main_menu, 'match', 'confirmed', 0);

-- Register PIN confirm -> register PIN (retry)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_register_pin_confirm, n_register_pin, 'match', 'retry', 1);

-- Main menu -> catalog (intent)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_main_menu, n_catalog_input, 'intent', 'catalog', 0);

-- Main menu -> cart (intent)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_main_menu, n_cart_menu, 'intent', 'cart', 1);

-- Main menu -> orders (intent)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_main_menu, n_orders_list, 'intent', 'orders', 2);

-- Main menu -> main menu (returns - loops)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_main_menu, n_main_menu, 'intent', 'returns', 3);

-- Catalog input -> catalog action (product found)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_input, n_catalog_action, 'match', 'found', 0);

-- Catalog input -> self (not found / retry)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_input, n_catalog_input, 'match', 'not_found', 1);

-- Catalog action -> catalog qty (add to cart)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_action, n_catalog_qty, 'intent', 'add_to_cart', 0);

-- Catalog action -> self (more details)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_action, n_catalog_action, 'intent', 'more_details', 1);

-- Catalog action -> self (reviews)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_action, n_catalog_action, 'intent', 'reviews', 2);

-- Catalog action -> catalog input (another)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_action, n_catalog_input, 'intent', 'another', 3);

-- Catalog action -> main menu
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_action, n_main_menu, 'intent', 'main_menu', 4);

-- Catalog qty -> qty confirm
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_qty, n_catalog_qty_confirm, 'default', NULL, 0);

-- Catalog qty confirm -> after add (confirmed)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_qty_confirm, n_catalog_after_add, 'match', 'confirmed', 0);

-- Catalog qty confirm -> catalog qty (retry)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_qty_confirm, n_catalog_qty, 'match', 'retry', 1);

-- Catalog after add -> catalog input (another)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_after_add, n_catalog_input, 'intent', 'another', 0);

-- Catalog after add -> cart menu (checkout)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_after_add, n_cart_menu, 'intent', 'checkout', 1);

-- Catalog after add -> main menu
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_catalog_after_add, n_main_menu, 'intent', 'main_menu', 2);

-- Cart menu -> cart list
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_menu, n_cart_list, 'intent', 'list_items', 0);

-- Cart menu -> checkout
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_menu, n_checkout_address_choice, 'intent', 'checkout', 1);

-- Cart menu -> change
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_menu, n_cart_change_id, 'intent', 'change_item', 2);

-- Cart menu -> remove
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_menu, n_cart_remove_id, 'intent', 'remove_item', 3);

-- Cart menu -> main menu
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_menu, n_main_menu, 'intent', 'main_menu', 4);

-- Cart list -> cart menu (default back)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_list, n_cart_menu, 'default', NULL, 0);

-- Cart change ID -> cart change qty
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_change_id, n_cart_change_qty, 'match', 'found', 0);

-- Cart change ID -> self (not found)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_change_id, n_cart_change_id, 'match', 'not_found', 1);

-- Cart change qty -> cart change confirm
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_change_qty, n_cart_change_confirm, 'default', NULL, 0);

-- Cart change confirm -> cart menu (confirmed)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_change_confirm, n_cart_menu, 'match', 'confirmed', 0);

-- Cart change confirm -> cart change qty (retry)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_change_confirm, n_cart_change_qty, 'match', 'retry', 1);

-- Cart remove ID -> cart remove confirm
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_remove_id, n_cart_remove_confirm, 'match', 'found', 0);

-- Cart remove ID -> self (not found)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_remove_id, n_cart_remove_id, 'match', 'not_found', 1);

-- Cart remove confirm -> cart menu (confirmed)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_remove_confirm, n_cart_menu, 'match', 'confirmed', 0);

-- Cart remove confirm -> cart menu (cancelled)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_cart_remove_confirm, n_cart_menu, 'match', 'cancelled', 1);

-- Checkout address choice -> address line1 (new address)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_address_choice, n_checkout_address_line1, 'match', 'new_address', 0);

-- Checkout address choice -> payment choice (saved address)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_address_choice, n_checkout_payment_choice, 'match', 'saved_address', 1);

-- Address line1 -> line2
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_address_line1, n_checkout_address_line2, 'default', NULL, 0);

-- Address line2 -> city
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_address_line2, n_checkout_address_city, 'default', NULL, 0);

-- Address city -> state
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_address_city, n_checkout_address_state, 'default', NULL, 0);

-- Address state -> zip
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_address_state, n_checkout_address_zip, 'default', NULL, 0);

-- Address zip -> address confirm
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_address_zip, n_checkout_address_confirm, 'default', NULL, 0);

-- Address confirm -> payment choice (confirmed)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_address_confirm, n_checkout_payment_choice, 'match', 'confirmed', 0);

-- Address confirm -> address line1 (retry)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_address_confirm, n_checkout_address_line1, 'match', 'retry', 1);

-- Payment choice -> summary (has card)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_payment_choice, n_checkout_summary, 'match', 'card_ready', 0);

-- Payment choice -> self (new card - payment pending TelTech integration)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_payment_choice, n_checkout_payment_choice, 'match', 'new_card', 1);

-- Summary -> confirm
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_summary, n_checkout_confirm, 'default', NULL, 0);

-- Confirm -> main menu (success)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_confirm, n_main_menu, 'match', 'confirmed', 0);

-- Confirm -> cart menu (cancelled)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_checkout_confirm, n_cart_menu, 'match', 'cancelled', 1);

-- Orders list -> orders detail
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_orders_list, n_orders_detail, 'default', NULL, 0);

-- Orders list -> main menu
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_orders_list, n_main_menu, 'intent', 'main_menu', 1);

-- Orders detail -> orders list (back)
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_orders_detail, n_orders_list, 'match', 'back', 0);

-- Orders detail -> main menu
INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
VALUES (v_version_id, n_orders_detail, n_main_menu, 'match', 'main_menu', 1);

END $$;
