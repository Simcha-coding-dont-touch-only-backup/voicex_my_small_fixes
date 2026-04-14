-- Update IVR node prompt_text and config for TelTech migration
-- Removes speech references, updates input_type from dtmf_speech to dtmf,
-- removes speech_hints, and updates prompt wording

-- register_name: voice recording via collect, not speech gather
UPDATE ivr_nodes SET
  prompt_text = 'Welcome to VoiceX! It looks like you are a new caller. To create an account, please say your full name after the beep, then press pound.',
  config = '{"input_type":"dtmf","timeout_seconds":10,"finish_on_key":"#"}'
WHERE node_key = 'register_name';

-- register_name_confirm: DTMF only
UPDATE ivr_nodes SET
  prompt_text = 'Press 1 to confirm your name, or press 2 to re-enter.',
  config = '{"input_type":"dtmf","num_digits":1,"timeout_seconds":10}'
WHERE node_key = 'register_name_confirm';

-- main_menu: remove "or say" from prompt, remove speech_hints, change input_type
UPDATE ivr_nodes SET
  prompt_text = 'Main Menu. Press 1 for Catalog to browse products. Press 2 for Cart to view your cart. Press 3 for Orders to check order status.',
  config = '{"input_type":"dtmf","timeout_seconds":8,"intents":[{"name":"catalog","dtmf_key":"1","speech_phrases":[],"target_node_key":"catalog_input"},{"name":"cart","dtmf_key":"2","speech_phrases":[],"target_node_key":"cart_menu"},{"name":"orders","dtmf_key":"3","speech_phrases":[],"target_node_key":"orders_list"},{"name":"returns","dtmf_key":"4","speech_phrases":[],"target_node_key":"main_menu"}]}'
WHERE node_key = 'main_menu';

-- catalog_action: remove "or say" from prompt, DTMF only
UPDATE ivr_nodes SET
  prompt_text = 'Press 1 to Add to Cart. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product. Press star for Main Menu.',
  config = '{"input_type":"dtmf","timeout_seconds":10,"intents":[{"name":"add_to_cart","dtmf_key":"1","speech_phrases":[],"target_node_key":"catalog_qty"},{"name":"more_details","dtmf_key":"2","speech_phrases":[],"target_node_key":"catalog_action"},{"name":"reviews","dtmf_key":"3","speech_phrases":[],"target_node_key":"catalog_action"},{"name":"another","dtmf_key":"4","speech_phrases":[],"target_node_key":"catalog_input"},{"name":"main_menu","dtmf_key":"*","speech_phrases":[],"target_node_key":"main_menu"}]}'
WHERE node_key = 'catalog_action';

-- catalog_after_add: remove "or say" from prompt, DTMF only
UPDATE ivr_nodes SET
  prompt_text = 'Press 1 for Another Product. Press 2 for Checkout. Press star for Main Menu.',
  config = '{"input_type":"dtmf","timeout_seconds":8,"intents":[{"name":"another","dtmf_key":"1","speech_phrases":[],"target_node_key":"catalog_input"},{"name":"checkout","dtmf_key":"2","speech_phrases":[],"target_node_key":"cart_menu"},{"name":"main_menu","dtmf_key":"*","speech_phrases":[],"target_node_key":"main_menu"}]}'
WHERE node_key = 'catalog_after_add';

-- cart_menu: DTMF only
UPDATE ivr_nodes SET
  prompt_text = 'Press 1 to hear all items. Press 2 to checkout. Press 3 to change an item. Press 4 to remove an item. Press star for Main Menu.',
  config = '{"input_type":"dtmf","timeout_seconds":10,"intents":[{"name":"list_items","dtmf_key":"1","speech_phrases":[],"target_node_key":"cart_list"},{"name":"checkout","dtmf_key":"2","speech_phrases":[],"target_node_key":"checkout_address_choice"},{"name":"change_item","dtmf_key":"3","speech_phrases":[],"target_node_key":"cart_change_id"},{"name":"remove_item","dtmf_key":"4","speech_phrases":[],"target_node_key":"cart_remove_id"},{"name":"main_menu","dtmf_key":"*","speech_phrases":[],"target_node_key":"main_menu"}]}'
WHERE node_key = 'cart_menu';

-- cart_list: DTMF only
UPDATE ivr_nodes SET
  config = '{"input_type":"dtmf","timeout_seconds":10}'
WHERE node_key = 'cart_list';

-- checkout_address_choice: DTMF only
UPDATE ivr_nodes SET
  config = '{"input_type":"dtmf","timeout_seconds":10}'
WHERE node_key = 'checkout_address_choice';

-- checkout_address_line1: voice recording with transcription
UPDATE ivr_nodes SET
  prompt_text = 'Please say your street address after the beep, then press pound.',
  config = '{"input_type":"voice","timeout_seconds":15}'
WHERE node_key = 'checkout_address_line1';

-- checkout_address_line2: voice recording with transcription
UPDATE ivr_nodes SET
  prompt_text = 'Say your apartment or unit number after the beep, or press pound to skip.',
  config = '{"input_type":"voice","timeout_seconds":10}'
WHERE node_key = 'checkout_address_line2';

-- checkout_address_city: voice recording with transcription
UPDATE ivr_nodes SET
  prompt_text = 'Please say your city name after the beep, then press pound.',
  config = '{"input_type":"voice","timeout_seconds":15}'
WHERE node_key = 'checkout_address_city';

-- checkout_address_state: voice recording with transcription
UPDATE ivr_nodes SET
  prompt_text = 'Please say your state name or state code after the beep, then press pound.',
  config = '{"input_type":"voice","timeout_seconds":10}'
WHERE node_key = 'checkout_address_state';

-- checkout_summary: DTMF only
UPDATE ivr_nodes SET
  config = '{"input_type":"dtmf","num_digits":1,"timeout_seconds":15}'
WHERE node_key = 'checkout_summary';

-- checkout_confirm: DTMF only
UPDATE ivr_nodes SET
  config = '{"input_type":"dtmf","num_digits":1,"timeout_seconds":15}'
WHERE node_key = 'checkout_confirm';

-- Payment choice edge comment update (no functional change, just the comment in seed was about Twilio Pay)
-- No SQL needed for comments in existing data

-- Update the seed file comment about Twilio Pay is not needed since
-- the migration data is already in the DB
