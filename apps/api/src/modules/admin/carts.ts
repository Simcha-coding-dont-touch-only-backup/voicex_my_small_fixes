import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

export const cartsRouter = Router();

cartsRouter.get('/', async (req, res) => {
  const {
    page = '1',
    per_page = '20',
    user_id,
    status,
  } = req.query;

  const perPage = parseInt(per_page as string);
  const offset = (parseInt(page as string) - 1) * perPage;

  let query = supabaseAdmin
    .from('carts')
    .select(
      '*, users(name, email, phone), cart_items(*, catalog_products(name, voicex_id))',
      { count: 'exact' },
    );

  if (status) {
    query = query.eq('status', status as string);
  } else {
    query = query.in('status', ['active', 'abandoned']);
  }

  if (user_id) query = query.eq('user_id', user_id as string);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + perPage - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({
    success: true,
    data: data || [],
    total: count || 0,
    page: parseInt(page as string),
    per_page: perPage,
    total_pages: Math.ceil((count || 0) / perPage),
  });
});
