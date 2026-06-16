-- Make `#` a no-op on the main menu only (IVR Option B).
--
-- Pressing `#` at the main menu was collected by the DTMF gather, matched no
-- intent, and fell through to re-rendering (re-speaking) the whole menu.
--
-- The dispatcher now honors a per-node `config.ignore_keys` list: when a caller
-- presses one of these keys on a `menu` node, the gather is re-armed without
-- matching an intent and without re-speaking the prompt. Here we set it to
-- `["#"]` on ONLY the active flow's `main_menu` node, so `#` is silently
-- ignored there while `*` (back) and digits continue to work normally and all
-- other nodes are unaffected.
UPDATE ivr_nodes n
SET config = jsonb_set(n.config, '{ignore_keys}', '["#"]'::jsonb, true)
FROM ivr_flow_versions v
JOIN ivr_flows f ON v.flow_id = f.id
WHERE n.flow_version_id = v.id
  AND f.is_active = true
  AND v.status = 'published'
  AND n.node_key = 'main_menu';
