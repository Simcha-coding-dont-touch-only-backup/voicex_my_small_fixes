-- Seed the Subscriptions IVR sub-flow into the active published flow version.
--
-- Every node is handler-driven (handler_name = node_key); the handlers live in
-- apps/api/src/modules/ivr/handlers/subscriptions-*.ts and embed the next
-- node_key directly (the Returns convention). Nodes still need to exist here so
-- the graph-dispatcher can look them up and the IVR editor can render them.
--
-- Also: main_menu gains option 5 -> subscriptions_entry, and PIN/registration
-- success now routes through subscriptions_alerts_announce (handled in code).

DO $$
DECLARE
  v_version UUID;
  v_main UUID;
BEGIN
  SELECT fv.id INTO v_version
  FROM ivr_flow_versions fv
  JOIN ivr_flows f ON f.id = fv.flow_id
  WHERE f.is_active = TRUE AND fv.status = 'published'
  LIMIT 1;

  IF v_version IS NULL THEN
    RAISE NOTICE 'No active published flow version; skipping subscription node seed.';
    RETURN;
  END IF;

  -- Insert all subscription handler nodes (idempotent on flow_version_id+node_key).
  INSERT INTO ivr_nodes (flow_version_id, node_key, node_type, handler_name, prompt_text, config, position_x, position_y)
  SELECT v_version, x.node_key, 'action', x.node_key, x.descr, '{"input_type":"dtmf"}'::jsonb, 1600, 0
  FROM (VALUES
    ('subscriptions_entry', 'Subscriptions entry / terms gate'),
    ('subscriptions_menu', 'Main subscription menu (render)'),
    ('subscriptions_menu_select', 'Main subscription menu (select)'),
    ('subscriptions_explanation', 'Explanation of how subscriptions work'),
    ('subscriptions_hear_select_week', 'Hear products: select week'),
    ('subscriptions_hear_package', 'Hear products: read package + menu'),
    ('subscriptions_hear_empty_action', 'Hear products: empty package menu'),
    ('subscriptions_hear_full_action', 'Hear products: package action menu'),
    ('subscriptions_add_select_week', 'Add products: select week'),
    ('subscriptions_add_product_entry', 'Add products: enter catalog number'),
    ('subscriptions_add_selected', 'Add products: product selected menu'),
    ('subscriptions_add_qty', 'Add products: enter quantity'),
    ('subscriptions_add_qty_confirm', 'Add products: confirm quantity'),
    ('subscriptions_add_done', 'Add products: added menu'),
    ('subscriptions_add_to_other', 'Add products: add same to another week'),
    ('subscriptions_edit_select_week', 'Edit quantity: select week'),
    ('subscriptions_edit_method', 'Edit quantity: id or list'),
    ('subscriptions_edit_id_entry', 'Edit quantity: enter id'),
    ('subscriptions_edit_list', 'Edit quantity: pick from list'),
    ('subscriptions_edit_qty_confirm', 'Edit quantity: enter/confirm new qty'),
    ('subscriptions_edit_done', 'Edit quantity: done menu'),
    ('subscriptions_transfer_select_week', 'Transfer: select week'),
    ('subscriptions_transfer_method', 'Transfer: id or list'),
    ('subscriptions_transfer_id_entry', 'Transfer: enter id'),
    ('subscriptions_transfer_list', 'Transfer: pick from list'),
    ('subscriptions_transfer_done', 'Transfer: pick destination'),
    ('subscriptions_transfer_after', 'Transfer: after transfer menu'),
    ('subscriptions_remove_select_week', 'Remove: select week'),
    ('subscriptions_remove_choice', 'Remove: all or specific'),
    ('subscriptions_remove_all_confirm', 'Remove: confirm clear package'),
    ('subscriptions_remove_all_done', 'Remove: package emptied menu'),
    ('subscriptions_remove_method', 'Remove: id or list'),
    ('subscriptions_remove_id_entry', 'Remove: enter id'),
    ('subscriptions_remove_list', 'Remove: pick from list'),
    ('subscriptions_remove_confirm', 'Remove: confirm removal'),
    ('subscriptions_remove_done', 'Remove: done menu'),
    ('subscriptions_pause_select', 'Pause/reactivate: select week or all'),
    ('subscriptions_pause_options', 'Pause: single delivery options'),
    ('subscriptions_pause_all_options', 'Pause: all deliveries options'),
    ('subscriptions_reactivate_confirm', 'Reactivate: confirm'),
    ('subscriptions_address_menu', 'Set address: menu'),
    ('subscriptions_address_select', 'Set address: choose option'),
    ('subscriptions_address_list', 'Set address: pick saved'),
    ('subscriptions_address_new', 'Set address: enter new'),
    ('subscriptions_address_new_save', 'Set address: confirm new'),
    ('subscriptions_card_menu', 'Set card: menu'),
    ('subscriptions_card_select', 'Set card: choose option'),
    ('subscriptions_card_list', 'Set card: pick saved'),
    ('subscriptions_card_number', 'Set card: enter number'),
    ('subscriptions_card_exp', 'Set card: enter expiry'),
    ('subscriptions_card_cvv', 'Set card: enter cvv'),
    ('subscriptions_card_confirm', 'Set card: enter zip + tokenize'),
    ('subscriptions_alerts_announce', 'Alerts inbox: announce'),
    ('subscriptions_alerts_choice', 'Alerts inbox: listen or continue'),
    ('subscriptions_alerts_read', 'Alerts inbox: read alert'),
    ('subscriptions_alerts_action', 'Alerts inbox: call to action'),
    ('subscriptions_alerts_retry', 'Alerts inbox: retry or skip delivery')
  ) AS x(node_key, descr)
  ON CONFLICT (flow_version_id, node_key) DO NOTHING;

  -- Main menu: add option 5 (Subscriptions) once.
  SELECT id INTO v_main FROM ivr_nodes WHERE flow_version_id = v_version AND node_key = 'main_menu';

  IF v_main IS NOT NULL THEN
    UPDATE ivr_nodes
    SET prompt_text = CASE
          WHEN prompt_text ILIKE '%subscription%' THEN prompt_text
          ELSE rtrim(prompt_text) || ' Press 5 for Subscriptions.'
        END,
        config = CASE
          WHEN config->'intents' @> '[{"dtmf_key":"5"}]'::jsonb THEN config
          ELSE jsonb_set(
            config,
            '{intents}',
            COALESCE(config->'intents', '[]'::jsonb) ||
              '[{"name":"subscriptions","dtmf_key":"5","speech_phrases":[],"target_node_key":"subscriptions_entry"}]'::jsonb
          )
        END
    WHERE id = v_main;

    INSERT INTO ivr_edges (flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority)
    SELECT v_version, v_main, n.id, 'intent', 'subscriptions', 5
    FROM ivr_nodes n
    WHERE n.flow_version_id = v_version AND n.node_key = 'subscriptions_entry'
      AND NOT EXISTS (
        SELECT 1 FROM ivr_edges e
        WHERE e.flow_version_id = v_version AND e.source_node_id = v_main
          AND e.condition_type = 'intent' AND e.condition_value = 'subscriptions'
      );
  END IF;
END $$;
