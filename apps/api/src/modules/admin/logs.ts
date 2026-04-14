import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

export const logsRouter = Router();

const LOGS_SORTABLE_COLUMNS = ['created_at', 'error_type', 'user_id', 'id'];

logsRouter.get('/', async (req, res) => {
  const {
    page = '1',
    per_page = '25',
    error_type,
    user_id,
    date_from,
    date_to,
    sort_by = 'created_at',
    sort_dir = 'desc',
  } = req.query;

  const sortColumn = LOGS_SORTABLE_COLUMNS.includes(sort_by as string) ? (sort_by as string) : 'created_at';
  const sortAscending = sort_dir === 'asc';

  const perPage = parseInt(per_page as string);
  const currentPage = parseInt(page as string);
  const offset = (currentPage - 1) * perPage;

  let query = supabaseAdmin
    .from('ivr_error_logs')
    .select('*', { count: 'exact' });

  if (error_type) {
    query = query.eq('error_type', error_type as string);
  }
  if (user_id) {
    query = query.eq('user_id', user_id as string);
  }
  if (date_from) {
    query = query.gte('created_at', date_from as string);
  }
  if (date_to) {
    query = query.lte('created_at', `${date_to}T23:59:59.999Z`);
  }

  const { data, count, error } = await query
    .order(sortColumn, { ascending: sortAscending })
    .range(offset, offset + perPage - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({
    success: true,
    data,
    total: count || 0,
    page: currentPage,
    per_page: perPage,
    total_pages: Math.ceil((count || 0) / perPage),
  });
});

logsRouter.get('/calls', async (req, res) => {
  const {
    page = '1',
    per_page = '25',
    date_from,
    date_to,
  } = req.query;

  const perPage = parseInt(per_page as string);
  const currentPage = parseInt(page as string);

  let query = supabaseAdmin
    .from('ivr_error_logs')
    .select('call_sid, caller_id, user_id, user_name, flow_version_id, created_at, node_key, error_type, error_detail, session_data');

  if (date_from) {
    query = query.gte('created_at', date_from as string);
  }
  if (date_to) {
    query = query.lte('created_at', `${date_to}T23:59:59.999Z`);
  }

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const callMap = new Map<string, any>();
  for (const row of data || []) {
    let call = callMap.get(row.call_sid);
    if (!call) {
      call = {
        call_sid: row.call_sid,
        caller_id: row.caller_id,
        user_id: row.user_id,
        user_name: row.user_name,
        flow_version_id: row.flow_version_id,
        started_at: row.created_at,
        ended_at: row.created_at,
        end_reason: null,
        step_count: 0,
        steps: [],
      };
      callMap.set(row.call_sid, call);
    }
    call.ended_at = row.created_at;

    if (row.error_type === 'call_end') {
      call.end_reason = 'hangup';
    } else {
      call.step_count++;
      call.steps.push({
        node: row.node_key,
        digits: row.session_data?.digits || null,
        time: row.created_at,
      });
    }
  }

  const calls = Array.from(callMap.values())
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  const total = calls.length;
  const offset = (currentPage - 1) * perPage;
  const paged = calls.slice(offset, offset + perPage);

  for (const call of paged) {
    const startMs = new Date(call.started_at).getTime();
    const endMs = new Date(call.ended_at).getTime();
    call.duration_seconds = Math.round((endMs - startMs) / 1000);
  }

  res.json({
    success: true,
    data: paged,
    total,
    page: currentPage,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  });
});

logsRouter.delete('/:id', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('ivr_error_logs')
    .delete()
    .eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true });
});

logsRouter.post('/bulk-delete', async (req, res) => {
  const { ids, call_sids } = req.body;

  if (Array.isArray(call_sids) && call_sids.length > 0) {
    const { error } = await supabaseAdmin
      .from('ivr_error_logs')
      .delete()
      .in('call_sid', call_sids);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, deleted_call_sids: call_sids.length });
    return;
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ success: false, error: 'ids or call_sids array is required' });
    return;
  }

  const { error } = await supabaseAdmin
    .from('ivr_error_logs')
    .delete()
    .in('id', ids);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, deleted: ids.length });
});
