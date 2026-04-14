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
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ success: false, error: 'ids array is required' });
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
