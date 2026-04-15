-- Add checkout_address_full node for single-prompt address collection
-- and rewire edges from address_choice and address_confirm to use it.

DO $$
DECLARE
  v_version_id UUID;
  n_checkout_address_full UUID;
  n_checkout_address_choice UUID;
  n_checkout_address_line1 UUID;
  n_checkout_address_confirm UUID;
BEGIN
  SELECT id INTO v_version_id FROM ivr_flow_versions WHERE is_published = true LIMIT 1;

  IF v_version_id IS NULL THEN
    RAISE NOTICE 'No published flow version found, skipping';
    RETURN;
  END IF;

  -- Look up existing node IDs
  SELECT id INTO n_checkout_address_choice FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'checkout_address_choice';
  SELECT id INTO n_checkout_address_line1 FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'checkout_address_line1';
  SELECT id INTO n_checkout_address_confirm FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'checkout_address_confirm';

  IF n_checkout_address_choice IS NULL OR n_checkout_address_line1 IS NULL OR n_checkout_address_confirm IS NULL THEN
    RAISE EXCEPTION 'Required IVR nodes not found. checkout_address_choice=%, checkout_address_line1=%, checkout_address_confirm=%',
      n_checkout_address_choice, n_checkout_address_line1, n_checkout_address_confirm;
  END IF;

  -- Insert the new address_full node
  INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
  VALUES (gen_random_uuid(), v_version_id, 'checkout_address_full', 'input', 'address_full',
    'Please say your complete address, including street, apartment or unit number if any, city, state, and zip code.',
    '{"input_type":"voice","timeout_seconds":25}',
    700, 550)
  RETURNING id INTO n_checkout_address_full;

  -- Update edge: address_choice -> new_address now points to address_full instead of address_line1
  UPDATE ivr_edges
  SET target_node_id = n_checkout_address_full
  WHERE flow_version_id = v_version_id
    AND source_node_id = n_checkout_address_choice
    AND condition_value = 'new_address';

  -- Update edge: address_confirm -> retry now points to address_full instead of address_line1
  UPDATE ivr_edges
  SET target_node_id = n_checkout_address_full
  WHERE flow_version_id = v_version_id
    AND source_node_id = n_checkout_address_confirm
    AND condition_value = 'retry';

  -- Add edge: address_full -> address_confirm (default, for successful validation)
  INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
  VALUES (v_version_id, n_checkout_address_full, n_checkout_address_confirm, 'default', NULL, 0);

  -- Add edge: address_full -> address_line1 (fallback, when freeform retries exhausted)
  INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
  VALUES (v_version_id, n_checkout_address_full, n_checkout_address_line1, 'match', 'fallback', 1);

END $$;
