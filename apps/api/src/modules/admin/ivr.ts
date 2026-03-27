import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

export const ivrRouter = Router();

// --- Flows ---

ivrRouter.get('/flows', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('ivr_flows')
    .select('*, ivr_flow_versions(id, version_number, status, published_at)')
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data });
});

ivrRouter.post('/flows', async (req, res) => {
  const { name, description } = req.body;

  const { data: flow, error } = await supabaseAdmin
    .from('ivr_flows')
    .insert({ name, description, is_active: false })
    .select()
    .single();

  if (error || !flow) {
    res.status(500).json({ success: false, error: error?.message });
    return;
  }

  const { data: version } = await supabaseAdmin
    .from('ivr_flow_versions')
    .insert({ flow_id: flow.id, version_number: 1, status: 'draft' })
    .select()
    .single();

  res.status(201).json({ success: true, data: { ...flow, versions: [version] } });
});

// --- Versions ---

ivrRouter.get('/flows/:flowId/versions/:versionId', async (req, res) => {
  const { data: version } = await supabaseAdmin
    .from('ivr_flow_versions')
    .select('*')
    .eq('id', req.params.versionId)
    .single();

  const { data: nodes } = await supabaseAdmin
    .from('ivr_nodes')
    .select('*')
    .eq('flow_version_id', req.params.versionId);

  const { data: edges } = await supabaseAdmin
    .from('ivr_edges')
    .select('*')
    .eq('flow_version_id', req.params.versionId);

  res.json({ success: true, data: { version, nodes, edges } });
});

ivrRouter.post('/flows/:flowId/versions/:versionId/publish', async (req, res) => {
  await supabaseAdmin
    .from('ivr_flow_versions')
    .update({ status: 'archived' })
    .eq('flow_id', req.params.flowId)
    .eq('status', 'published');

  const { data, error } = await supabaseAdmin
    .from('ivr_flow_versions')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', req.params.versionId)
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin
    .from('ivr_flows')
    .update({ is_active: true })
    .eq('id', req.params.flowId);

  res.json({ success: true, data });
});

// --- Nodes ---

ivrRouter.post('/nodes', async (req, res) => {
  const { flow_version_id, node_key, node_type, handler_name, prompt_text, prompt_ssml, config, position_x, position_y } = req.body;

  const { data, error } = await supabaseAdmin
    .from('ivr_nodes')
    .insert({
      flow_version_id,
      node_key,
      node_type,
      handler_name,
      prompt_text,
      prompt_ssml,
      config: config || {},
      position_x: position_x || 0,
      position_y: position_y || 0,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.status(201).json({ success: true, data });
});

ivrRouter.patch('/nodes/:id', async (req, res) => {
  const { node_key, node_type, handler_name, prompt_text, prompt_ssml, config, position_x, position_y } = req.body;

  const updates: Record<string, unknown> = {};
  if (node_key !== undefined) updates.node_key = node_key;
  if (node_type !== undefined) updates.node_type = node_type;
  if (handler_name !== undefined) updates.handler_name = handler_name;
  if (prompt_text !== undefined) updates.prompt_text = prompt_text;
  if (prompt_ssml !== undefined) updates.prompt_ssml = prompt_ssml;
  if (config !== undefined) updates.config = config;
  if (position_x !== undefined) updates.position_x = position_x;
  if (position_y !== undefined) updates.position_y = position_y;

  const { data, error } = await supabaseAdmin
    .from('ivr_nodes')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data });
});

ivrRouter.delete('/nodes/:id', async (req, res) => {
  await supabaseAdmin.from('ivr_edges').delete().or(`source_node_id.eq.${req.params.id},target_node_id.eq.${req.params.id}`);
  const { error } = await supabaseAdmin.from('ivr_nodes').delete().eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, message: 'Node deleted' });
});

// --- Edges ---

ivrRouter.post('/edges', async (req, res) => {
  const { flow_version_id, source_node_id, target_node_id, condition_type, condition_value, priority } = req.body;

  const { data, error } = await supabaseAdmin
    .from('ivr_edges')
    .insert({
      flow_version_id,
      source_node_id,
      target_node_id,
      condition_type,
      condition_value,
      priority: priority || 0,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.status(201).json({ success: true, data });
});

ivrRouter.delete('/edges/:id', async (req, res) => {
  const { error } = await supabaseAdmin.from('ivr_edges').delete().eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, message: 'Edge deleted' });
});
