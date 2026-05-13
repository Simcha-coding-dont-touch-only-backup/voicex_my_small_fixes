import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { orderIdFromParam } from '../../lib/order-id.js';
import { etaPayloadSchema, replaceOrderFulfillmentEtas, sortOrderFulfillmentEtas } from './order-etas.js';

export const ordersRouter = Router();

const ORDERS_SORTABLE_COLUMNS = ['created_at', 'status', 'user_id', 'id', 'total_cents'];
const ORDER_DETAIL_SELECT = '*, users(name, email), order_items(*), order_events(*), addresses(*), order_fulfillment_etas(*)';

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

  const sortColumn = ORDERS_SORTABLE_COLUMNS.includes(sort_by as string) ? (sort_by as string) : 'created_at';
  const sortAscending = sort_dir === 'asc';
  const offset = (parseInt(page as string) - 1) * parseInt(per_page as string);

  let query = supabaseAdmin
    .from('orders')
    .select('*, users(name, email), order_items(product_name, quantity, unit_price_cents)', { count: 'exact' });

  if (user_id) query = query.eq('user_id', user_id as string);
  if (status) query = query.eq('status', status as string);
  if (date_from) query = query.gte('created_at', date_from as string);
  if (date_to) query = query.lte('created_at', `${date_to}T23:59:59.999Z`);

  const { data, count, error } = await query
    .order(sortColumn, { ascending: sortAscending })
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
  const id = orderIdFromParam(req.params.id);
  if (!id) {
    res.status(404).json({ success: false, error: 'Order not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(ORDER_DETAIL_SELECT)
    .eq('id', id)
    .single();

  if (error || !data) {
    res.status(404).json({ success: false, error: 'Order not found' });
    return;
  }

  res.json({ success: true, data: sortOrderFulfillmentEtas(data as any) });
});

ordersRouter.put('/:id/etas', async (req, res) => {
  const parsed = etaPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid ETA request' });
    return;
  }

  const id = orderIdFromParam(req.params.id);
  if (!id) {
    res.status(404).json({ success: false, error: 'Order not found' });
    return;
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .single();

  if (orderError || !order) {
    res.status(404).json({ success: false, error: 'Order not found' });
    return;
  }

  try {
    await replaceOrderFulfillmentEtas(String(order.id), parsed.data.etas, req.adminUser?.id);

    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_user_id: req.adminUser?.id ?? null,
      action: 'update_order_etas',
      entity_type: 'order',
      entity_id: String(order.id),
      changes: { etas: parsed.data.etas },
    });

    await supabaseAdmin.from('order_events').insert({
      order_id: String(order.id),
      status: order.status,
      source: 'admin',
      details: { action: 'update_order_etas', etas: parsed.data.etas },
    });

    const { data: updated, error } = await supabaseAdmin
      .from('orders')
      .select(ORDER_DETAIL_SELECT)
      .eq('id', String(order.id))
      .single();

    if (error || !updated) throw new Error(error?.message || 'Failed to reload order');

    res.json({ success: true, data: sortOrderFulfillmentEtas(updated as any) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to update ETAs' });
  }
});
