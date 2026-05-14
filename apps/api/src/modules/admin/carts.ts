import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

export const cartsRouter = Router();

const CARTS_SORTABLE_COLUMNS = ['created_at', 'status', 'user_id'];

cartsRouter.get('/', async (req, res) => {
  const {
    page = '1',
    per_page = '20',
    user_id,
    status,
    sort_by = 'created_at',
    sort_dir = 'desc',
  } = req.query;

  const sortColumn = CARTS_SORTABLE_COLUMNS.includes(sort_by as string)
    ? (sort_by as string)
    : 'created_at';
  const sortAscending = sort_dir === 'asc';
  const perPage = parseInt(per_page as string);
  const offset = (parseInt(page as string) - 1) * perPage;

  let query = supabaseAdmin
    .from('carts')
    .select(
      '*, users(name, email, is_whitelisted, user_phones(phone_number, is_primary)), cart_items(*, catalog_products(voicex_id, voice_name, amazon_name))',
      { count: 'exact' },
    );

  if (status) {
    query = query.eq('status', status as string);
  } else {
    query = query.in('status', ['active', 'abandoned']);
  }

  if (user_id) query = query.eq('user_id', user_id as string);

  const { data, count, error } = await query
    .order(sortColumn, { ascending: sortAscending })
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

cartsRouter.delete('/:cartId', async (req, res) => {
  const { cartId } = req.params;
  const { error } = await supabaseAdmin
    .from('carts')
    .delete()
    .eq('id', cartId)
    .neq('status', 'checked_out');
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true });
});

cartsRouter.delete('/:cartId/items/:itemId', async (req, res) => {
  const { cartId, itemId } = req.params;
  const { error } = await supabaseAdmin
    .from('cart_items')
    .delete()
    .eq('id', itemId)
    .eq('cart_id', cartId);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  const { count } = await supabaseAdmin
    .from('cart_items')
    .select('id', { count: 'exact', head: true })
    .eq('cart_id', cartId);
  if (count === 0) {
    await supabaseAdmin.from('carts').delete().eq('id', cartId).neq('status', 'checked_out');
  }
  res.json({ success: true });
});
