-- catalog_after_add: replace the star prompt with an explicit "Press 3 for Main Menu"
-- option and add a dtmf_key=3 intent routing to main_menu. The catalog_after_add
-- -> main_menu edge already exists (intent 'main_menu'); this only wires key 3 to
-- it and updates the spoken prompt. The universal '*' back handler is unaffected.

UPDATE ivr_nodes
SET prompt_text = 'Press 1 for Another Product. Press 2 for Checkout. Press 3 for Main Menu.'
WHERE node_key = 'catalog_after_add';

UPDATE ivr_nodes
SET config = jsonb_set(
  config,
  '{intents}',
  (
    SELECT jsonb_agg(i)
    FROM jsonb_array_elements(config->'intents') AS i
    WHERE i->>'name' <> 'main_menu'
  )
  || jsonb_build_array(
    jsonb_build_object(
      'name', 'main_menu',
      'dtmf_key', '3',
      'speech_phrases', '[]'::jsonb,
      'target_node_key', 'main_menu'
    )
  )
)
WHERE node_key = 'catalog_after_add'
  AND config ? 'intents';
