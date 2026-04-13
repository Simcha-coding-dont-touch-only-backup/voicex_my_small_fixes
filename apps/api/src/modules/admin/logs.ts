import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

export const logsRouter = Router();

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
    query = query.lte('created_at', date_to as string);
  }

  const { data, count, error } = await query
    .order(sort_by as string, { ascending: sort_dir === 'asc' })
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
