-- Add the checkout_verify_wait poll node between checkout_confirm and
-- checkout_final_confirm.
--
-- Checkout revalidation against Rainforest can take several seconds per item.
-- Running it all inside one TelTech webhook risks exceeding the provider's
-- ~10s api_timeout and dropping the call (this broke live payments 2026-06-22).
-- Instead, order_confirm enqueues the revalidation job into the call session and
-- redirects to checkout_verify_wait, which drains a bounded parallel batch per
-- webhook and loops ("please hold") until done, then routes to
-- checkout_final_confirm. The handler embeds the next node_key directly; edges
-- here are for the IVR editor graph view, mirroring 00006_add_checkout_stock_nodes.

DO $$
DECLARE
  v_version_id UUID;
  n_checkout_confirm UUID;
  n_checkout_verify_wait UUID;
  n_checkout_final_confirm UUID;
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

  SELECT id INTO n_checkout_confirm FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'checkout_confirm';
  SELECT id INTO n_checkout_final_confirm FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'checkout_final_confirm';

  INSERT INTO ivr_nodes (id, flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
  VALUES (gen_random_uuid(), v_version_id, 'checkout_verify_wait', 'action', 'verify_wait',
    'Verifying your order.',
    '{"input_type":"dtmf","num_digits":1,"timeout_seconds":15}'::jsonb,
    560, 1950)
  ON CONFLICT (flow_version_id, node_key) DO NOTHING
  RETURNING id INTO n_checkout_verify_wait;

  IF n_checkout_verify_wait IS NULL THEN
    SELECT id INTO n_checkout_verify_wait FROM ivr_nodes WHERE flow_version_id = v_version_id AND node_key = 'checkout_verify_wait';
  END IF;

  -- checkout_confirm -> checkout_verify_wait (confirmed)
  INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
  SELECT v_version_id, n_checkout_confirm, n_checkout_verify_wait, 'match', 'confirmed', 0
  WHERE n_checkout_confirm IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ivr_edges
      WHERE flow_version_id = v_version_id
        AND source_node_id = n_checkout_confirm
        AND target_node_id = n_checkout_verify_wait
    );

  -- checkout_verify_wait -> checkout_verify_wait (still verifying, self-loop)
  INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
  SELECT v_version_id, n_checkout_verify_wait, n_checkout_verify_wait, 'match', 'verifying', 0
  WHERE NOT EXISTS (
    SELECT 1 FROM ivr_edges
    WHERE flow_version_id = v_version_id
      AND source_node_id = n_checkout_verify_wait
      AND target_node_id = n_checkout_verify_wait
  );

  -- checkout_verify_wait -> checkout_final_confirm (verified)
  INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
  SELECT v_version_id, n_checkout_verify_wait, n_checkout_final_confirm, 'match', 'verified', 1
  WHERE n_checkout_final_confirm IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ivr_edges
      WHERE flow_version_id = v_version_id
        AND source_node_id = n_checkout_verify_wait
        AND target_node_id = n_checkout_final_confirm
    );
END $$;
