import { Router, raw } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { getHandlerNames } from '../ivr/handler-registry.js';
import { ivrRuntime } from '../ivr/runtime.js';
import { uploadIvrAudio, deleteIvrAudio, extForAudioContentType } from '../../lib/ivr-audio.js';

export const ivrRouter = Router();

// --- Handlers list ---

ivrRouter.get('/handlers', (_req, res) => {
  res.json({ success: true, data: getHandlerNames() });
});

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

ivrRouter.delete('/flows/:id', async (req, res) => {
  const { error } = await supabaseAdmin.from('ivr_flows').delete().eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, message: 'Flow deleted' });
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
    .eq('flow_version_id', req.params.versionId)
    .order('created_at', { ascending: true });

  const { data: edges } = await supabaseAdmin
    .from('ivr_edges')
    .select('*')
    .eq('flow_version_id', req.params.versionId)
    .order('priority', { ascending: true });

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

  ivrRuntime.invalidateCache();

  res.json({ success: true, data });
});

ivrRouter.post('/flows/:flowId/versions/:versionId/invalidate-cache', async (_req, res) => {
  ivrRuntime.invalidateCache();
  res.json({ success: true, message: 'Cache invalidated' });
});

ivrRouter.post('/flows/:flowId/versions/:versionId/clone', async (req, res) => {
  const sourceVersionId = req.params.versionId;
  const flowId = req.params.flowId;

  const { data: versions } = await supabaseAdmin
    .from('ivr_flow_versions')
    .select('version_number')
    .eq('flow_id', flowId)
    .order('version_number', { ascending: false })
    .limit(1);

  const nextVersion = (versions?.[0]?.version_number || 0) + 1;

  const { data: newVersion, error: verError } = await supabaseAdmin
    .from('ivr_flow_versions')
    .insert({ flow_id: flowId, version_number: nextVersion, status: 'draft' })
    .select()
    .single();

  if (verError || !newVersion) {
    res.status(500).json({ success: false, error: verError?.message });
    return;
  }

  const { data: sourceNodes } = await supabaseAdmin
    .from('ivr_nodes')
    .select('*')
    .eq('flow_version_id', sourceVersionId);

  if (sourceNodes && sourceNodes.length > 0) {
    const nodeIdMap = new Map<string, string>();

    for (const node of sourceNodes) {
      const newNodeId = crypto.randomUUID();
      nodeIdMap.set(node.id, newNodeId);
    }

    const newNodes = sourceNodes.map((node) => ({
      id: nodeIdMap.get(node.id)!,
      flow_version_id: newVersion.id,
      node_key: node.node_key,
      node_type: node.node_type,
      handler_name: node.handler_name,
      prompt_text: node.prompt_text,
      prompt_ssml: node.prompt_ssml,
      config: node.config,
      position_x: node.position_x,
      position_y: node.position_y,
    }));

    await supabaseAdmin.from('ivr_nodes').insert(newNodes);

    const { data: sourceEdges } = await supabaseAdmin
      .from('ivr_edges')
      .select('*')
      .eq('flow_version_id', sourceVersionId);

    if (sourceEdges && sourceEdges.length > 0) {
      const newEdges = sourceEdges
        .filter((e) => nodeIdMap.has(e.source_node_id) && nodeIdMap.has(e.target_node_id))
        .map((edge) => ({
          flow_version_id: newVersion.id,
          source_node_id: nodeIdMap.get(edge.source_node_id)!,
          target_node_id: nodeIdMap.get(edge.target_node_id)!,
          condition_type: edge.condition_type,
          condition_value: edge.condition_value,
          priority: edge.priority,
        }));

      if (newEdges.length > 0) {
        await supabaseAdmin.from('ivr_edges').insert(newEdges);
      }
    }
  }

  res.status(201).json({ success: true, data: newVersion });
});

// --- Nodes ---

// Batch position update must come before :id routes
ivrRouter.patch('/nodes/batch/positions', async (req, res) => {
  const { positions } = req.body;

  if (!Array.isArray(positions)) {
    res.status(400).json({ success: false, error: 'positions must be an array' });
    return;
  }

  for (const { id, position_x, position_y } of positions) {
    await supabaseAdmin
      .from('ivr_nodes')
      .update({ position_x, position_y })
      .eq('id', id);
  }

  res.json({ success: true, message: `Updated ${positions.length} node positions` });
});

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

// --- Node prompt recordings (audio) ---

// Accept the raw audio bytes (no multipart dependency needed). The app-level
// express.json() only parses `application/json`, so an audio upload streams
// straight through to this route's raw() parser. ~8MB cap — prompts are short.
ivrRouter.post(
  '/nodes/:id/audio',
  raw({ type: ['audio/*', 'application/octet-stream'], limit: '8mb' }),
  async (req, res) => {
    const contentType = (req.headers['content-type'] || '').toString();
    const ext = extForAudioContentType(contentType);
    if (!ext) {
      res.status(400).json({ success: false, error: 'Unsupported audio type. Please upload an MP3 or WAV file.' });
      return;
    }

    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ success: false, error: 'No audio data received.' });
      return;
    }

    try {
      const { path, url } = await uploadIvrAudio(req.params.id, body, contentType.split(';')[0].trim());
      res.json({ success: true, data: { path, url } });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Upload failed' });
    }
  },
);

ivrRouter.delete('/nodes/:id/audio', async (req, res) => {
  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (!path) {
    res.status(400).json({ success: false, error: 'Missing audio path.' });
    return;
  }
  // Safety: only allow removing files namespaced under this node.
  if (!path.startsWith(`${req.params.id}/`)) {
    res.status(400).json({ success: false, error: 'Audio path does not belong to this node.' });
    return;
  }

  try {
    await deleteIvrAudio(path);
    res.json({ success: true, message: 'Recording removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Delete failed' });
  }
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

ivrRouter.patch('/edges/:id', async (req, res) => {
  const { condition_type, condition_value, priority } = req.body;

  const updates: Record<string, unknown> = {};
  if (condition_type !== undefined) updates.condition_type = condition_type;
  if (condition_value !== undefined) updates.condition_value = condition_value;
  if (priority !== undefined) updates.priority = priority;

  const { data, error } = await supabaseAdmin
    .from('ivr_edges')
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

ivrRouter.delete('/edges/:id', async (req, res) => {
  const { error } = await supabaseAdmin.from('ivr_edges').delete().eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, message: 'Edge deleted' });
});
