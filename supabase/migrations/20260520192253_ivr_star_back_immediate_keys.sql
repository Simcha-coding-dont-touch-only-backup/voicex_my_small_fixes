-- Make '*' a universal 'back' key with immediate effect.
-- 1) Ensure single-digit menus have num_digits=1 (so all keys, including '*', take effect without '#').
-- 2) Remove now-redundant dtmf_key='*' intents that hardcoded a jump to main_menu;
--    the universal '*' handler in gather-result.ts now pops the menu stack instead.
-- 3) Update prompts that said 'Press star for Main Menu.' to 'Press star to go back.'

UPDATE ivr_nodes
SET config = config || '{"num_digits": 1}'::jsonb
WHERE node_key IN ('main_menu', 'catalog_action', 'catalog_after_add', 'cart_menu')
  AND COALESCE(config->>'num_digits', '') <> '1';

UPDATE ivr_nodes
SET config = jsonb_set(
      config,
      '{intents}',
      COALESCE(
        (SELECT jsonb_agg(i)
           FROM jsonb_array_elements(config->'intents') AS i
          WHERE i->>'dtmf_key' <> '*'),
        '[]'::jsonb
      )
    )
WHERE node_key IN ('main_menu', 'catalog_action', 'catalog_after_add', 'cart_menu')
  AND config ? 'intents'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(config->'intents') AS i
    WHERE i->>'dtmf_key' = '*'
  );

UPDATE ivr_nodes
SET prompt_text = REPLACE(prompt_text, 'Press star for Main Menu.', 'Press star to go back.')
WHERE node_key IN ('catalog_action', 'catalog_after_add', 'cart_menu')
  AND prompt_text LIKE '%Press star for Main Menu.%';
