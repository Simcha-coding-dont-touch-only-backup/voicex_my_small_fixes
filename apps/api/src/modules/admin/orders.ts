import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

export const ordersRouter = Router();

ordersRouter.get('/', async (req, res) => {
  const {
    page = '1',
    per_page = '20',
    user_id,
    status,
    date_from,
    date_to,
    product_id,
    sort_by = 'created_at',
    sort_dir = 'desc',
  } = req.query;

  const offset = (parseInt(page as string) - 1) * parseInt(per_page as string);

  let query = supabaseAdmin
    .from('orders')
    .select('*, users(name, email), order_items(product_name, quantity, unit_price_cents)', { count: 'exact' });

  if (user_id) query = query.eq('user_id', user_id as string);
  if (status) query = query.eq('status', status as string);
  if (date_from) query = query.gte('created_at', date_from as string);
  if (date_to) query = query.lte('created_at', `${date_to}T23:59:59.999Z`);

  const { data, count, error } = await query
    .order(sort_by as string, { ascending: sort_dir === 'asc' })
    .range(offset, offset + parseInt(per_page as string) - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  let filtered = data || [];
  if (product_id) {
    filtered = filtered.filter((order: any) =>
      order.order_items?.some((item: any) => item.product_id === product_id)
    );
  }

  res.json({
    success: true,
    data: filtered,
    total: count || 0,
    page: parseInt(page as string),
    per_page: parseInt(per_page as string),
    total_pages: Math.ceil((count || 0) / parseInt(per_page as string)),
  });
});

ordersRouter.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*, users(name, email), order_items(*), order_events(*), addresses(*)')
    .eq('id', req.params.id)
    .single();

  if (error || !data) {
    res.status(404).json({ success: false, error: 'Order not found' });
    return;
  }

  res.json({ success: true, data });
});
