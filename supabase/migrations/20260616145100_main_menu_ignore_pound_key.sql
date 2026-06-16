-- Scope `#` to a no-op on the main menu only.
--
-- The DTMF gather builder defaults to a capture regex of `[0-9*#]+`, so
-- pressing `#` at the main menu was collected and submitted, matched no
-- intent, and fell through to re-rendering (re-speaking) the whole menu.
--
-- Restricting just this node's gather regex to `[0-9*]+` makes the telephony
-- provider ignore the `#` keypress (it is no longer a valid collected digit),
-- so the prompt is not repeated. `*` is preserved as the universal back key.
--
-- This intentionally affects ONLY the active flow's `main_menu` node.
UPDATE ivr_nodes n
SET config = jsonb_set(n.config, '{regex}', '"[0-9*]+"'::jsonb, true)
FROM ivr_flow_versions v
JOIN ivr_flows f ON v.flow_id = f.id
WHERE n.flow_version_id = v.id
  AND f.is_active = true
  AND v.status = 'published'
  AND n.node_key = 'main_menu';
