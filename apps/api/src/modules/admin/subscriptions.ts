import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import {
  getDeliveries,
  getDeliveryItems,
  getDelivery,
  priceDeliveryItems,
  setDeliveryItemQuantity,
  removeDeliveryItem,
  transferDeliveryItem,
  pauseDelivery,
  reactivateDelivery,
  setSubscriptionAddress,
  setSubscriptionCard,
  logSubscriptionEvent,
  getOrCreateDelivery,
  type DeliveryRow,
} from '../../lib/subscriptions.js';
import {
  createFailedDeliveryAlert,
  resolveSubscriptionAlertsForUser,
} from '../../lib/subscription-alerts.js';
import {
  SUBSCRIPTION_ALERT_TYPES,
  ADMIN_ALERT_TYPES,
} from '@voicex/shared';

export const subscriptionsRouter = Router();

type DisplayStatus = 'active' | 'temp_paused' | 'perm_paused' | 'failed';

async function latestRunStatus(deliveryId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('subscription_delivery_runs')
    .select('status')
    .eq('delivery_id', deliveryId)
    .order('cycle_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.status ?? null;
}

async function buildDeliveryCard(delivery: DeliveryRow, isWhitelisted: boolean) {
  const items = await getDeliveryItems(delivery.id);
  const priced = await priceDeliveryItems(items, isWhitelisted);
  const lastRun = await latestRunStatus(delivery.id);
  let display: DisplayStatus = delivery.status as DisplayStatus;
  if (delivery.status === 'active' && lastRun === 'failed') display = 'failed';
  return {
    delivery_id: delivery.id,
    week_number: delivery.week_number,
    status: delivery.status,
    display_status: display,
    pause_type: delivery.pause_type,
    paused_cycles: delivery.paused_cycles,
    pause_resume_date: delivery.pause_resume_date,
    paused_at: delivery.paused_at,
    next_cycle_date: delivery.next_cycle_date,
    products: priced.total_products,
    total_quantity: priced.total_quantity,
    cost_cents: priced.subtotal_cents,
  };
}

async function buildSubscriptionRow(sub: any) {
  const isWhitelisted = !!sub.users?.is_whitelisted;
  const deliveries = await getDeliveries(sub.id);
  const cards = await Promise.all(deliveries.map((d) => buildDeliveryCard(d, isWhitelisted)));
  const byWeek = new Map(cards.map((c) => [c.week_number, c]));
  const weeks = [1, 2, 3, 4].map((w) => byWeek.get(w) || null);

  const totalProducts = cards.reduce((s, c) => s + c.products, 0);
  const totalCost = cards.reduce((s, c) => s + c.cost_cents, 0);

  const { data: phone } = await supabaseAdmin
    .from('user_phones')
    .select('phone_number')
    .eq('user_id', sub.user_id)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: alertCount } = await supabaseAdmin
    .from('admin_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', sub.user_id)
    .in('alert_type', SUBSCRIPTION_ALERT_TYPES as unknown as string[])
    .neq('status', 'resolved');

  return {
    subscription_id: sub.id,
    user_id: sub.user_id,
    customer_name: sub.users?.name || 'Unknown',
    email: sub.users?.email || null,
    phone: phone?.phone_number || null,
    subscription_address_id: sub.subscription_address_id,
    payment_method_id: sub.payment_method_id,
    total_products: totalProducts,
    total_cost_cents: totalCost,
    weeks,
    open_alert_count: alertCount || 0,
  };
}

// ============================================================
// Management list + detail
// ============================================================

subscriptionsRouter.get('/', async (req, res) => {
  const page = parseInt((req.query.page as string) || '1', 10);
  const perPage = parseInt((req.query.per_page as string) || '20', 10);
  const search = (req.query.search as string)?.trim();
  const statusFilter = req.query.status as DisplayStatus | undefined;

  let userIds: string[] | null = null;
  if (search) {
    // Match by customer name or phone number.
    const [{ data: byName }, { data: byPhone }] = await Promise.all([
      supabaseAdmin.from('users').select('id').ilike('name', `%${search}%`).limit(500),
      supabaseAdmin.from('user_phones').select('user_id').ilike('phone_number', `%${search}%`).limit(500),
    ]);
    userIds = [
      ...new Set([...(byName || []).map((u) => u.id), ...(byPhone || []).map((p) => p.user_id)]),
    ];
    if (userIds.length === 0) {
      res.json({ success: true, data: [], total: 0, page, per_page: perPage });
      return;
    }
  }

  let query = supabaseAdmin
    .from('subscriptions')
    .select('*, users(name, email, is_whitelisted)', { count: 'exact' });
  if (userIds) query = query.in('user_id', userIds);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  let rows = await Promise.all((data || []).map(buildSubscriptionRow));
  if (statusFilter) {
    rows = rows.filter((r) => r.weeks.some((w) => w && w.display_status === statusFilter));
  }

  res.json({ success: true, data: rows, total: count || 0, page, per_page: perPage });
});

subscriptionsRouter.get('/:id', async (req, res) => {
  const { data: sub, error } = await supabaseAdmin
    .from('subscriptions')
    .select('*, users(name, email, is_whitelisted)')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error || !sub) {
    res.status(404).json({ success: false, error: 'Subscription not found' });
    return;
  }
  const row = await buildSubscriptionRow(sub);
  res.json({ success: true, data: row });
});

// Ensure a delivery row exists for a (subscription, week) so the admin can edit
// an empty week's package. Returns the delivery id.
subscriptionsRouter.post('/:id/deliveries/:week/ensure', async (req, res) => {
  const week = parseInt(req.params.week, 10);
  if (!(week >= 1 && week <= 4)) { res.status(400).json({ success: false, error: 'Invalid week' }); return; }
  const { data: sub } = await supabaseAdmin.from('subscriptions').select('id').eq('id', req.params.id).maybeSingle();
  if (!sub) { res.status(404).json({ success: false, error: 'Subscription not found' }); return; }
  const delivery = await getOrCreateDelivery(sub.id, week);
  res.json({ success: true, data: { delivery_id: delivery.id } });
});

// ============================================================
// Delivery package items
// ============================================================

subscriptionsRouter.get('/deliveries/:deliveryId/items', async (req, res) => {
  const delivery = await getDelivery(req.params.deliveryId);
  if (!delivery) {
    res.status(404).json({ success: false, error: 'Delivery not found' });
    return;
  }
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('id, user_id, users(is_whitelisted)')
    .eq('id', delivery.subscription_id)
    .maybeSingle();
  const isWhitelisted = !!(sub as any)?.users?.is_whitelisted;
  const items = await getDeliveryItems(delivery.id);
  const priced = await priceDeliveryItems(items, isWhitelisted);
  res.json({
    success: true,
    data: {
      delivery,
      lines: priced.lines.map((l) => ({
        product_id: l.product_id,
        voicex_id: l.voicex_id,
        product_name: l.product_name,
        amazon_asin: l.product.amazon_asin,
        thumbnail_url: (l.product as any).thumbnail_url ?? null,
        amazon_price_cents: l.amazon_price_cents,
        unit_price_cents: l.unit_price_cents,
        quantity: l.quantity,
        line_total_cents: l.line_total_cents,
      })),
      subtotal_cents: priced.subtotal_cents,
    },
  });
});

const itemSchema = z.object({ product_id: z.string().uuid(), quantity: z.coerce.number().int().min(1) });

subscriptionsRouter.post('/deliveries/:deliveryId/items', async (req, res) => {
  const delivery = await getDelivery(req.params.deliveryId);
  if (!delivery) { res.status(404).json({ success: false, error: 'Delivery not found' }); return; }
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  // Only enabled products may be added.
  const { data: product } = await supabaseAdmin
    .from('catalog_products')
    .select('status')
    .eq('id', parsed.data.product_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!product || product.status !== 'active') {
    res.status(400).json({ success: false, error: 'Only enabled products can be added to a subscription' });
    return;
  }

  await setDeliveryItemQuantity(delivery.id, parsed.data.product_id, parsed.data.quantity);
  await logSubscriptionEvent({
    subscriptionId: delivery.subscription_id, deliveryId: delivery.id,
    eventType: 'item_added', actorType: 'admin', actorAdminId: req.adminUser?.id ?? null,
    details: { product_id: parsed.data.product_id, quantity: parsed.data.quantity, week: delivery.week_number },
  });
  res.json({ success: true });
});

const qtySchema = z.object({ quantity: z.coerce.number().int().min(1) });

subscriptionsRouter.patch('/deliveries/:deliveryId/items/:productId', async (req, res) => {
  const delivery = await getDelivery(req.params.deliveryId);
  if (!delivery) { res.status(404).json({ success: false, error: 'Delivery not found' }); return; }
  const parsed = qtySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }
  await setDeliveryItemQuantity(delivery.id, req.params.productId, parsed.data.quantity);
  await logSubscriptionEvent({
    subscriptionId: delivery.subscription_id, deliveryId: delivery.id,
    eventType: 'item_qty_updated', actorType: 'admin', actorAdminId: req.adminUser?.id ?? null,
    details: { product_id: req.params.productId, quantity: parsed.data.quantity, week: delivery.week_number },
  });
  res.json({ success: true });
});

subscriptionsRouter.delete('/deliveries/:deliveryId/items/:productId', async (req, res) => {
  const delivery = await getDelivery(req.params.deliveryId);
  if (!delivery) { res.status(404).json({ success: false, error: 'Delivery not found' }); return; }
  await removeDeliveryItem(delivery.id, req.params.productId);
  await logSubscriptionEvent({
    subscriptionId: delivery.subscription_id, deliveryId: delivery.id,
    eventType: 'item_removed', actorType: 'admin', actorAdminId: req.adminUser?.id ?? null,
    details: { product_id: req.params.productId, week: delivery.week_number },
  });
  res.json({ success: true });
});

const transferSchema = z.object({ product_id: z.string().uuid(), to_week: z.coerce.number().int().min(1).max(4) });

subscriptionsRouter.post('/deliveries/:deliveryId/transfer', async (req, res) => {
  const delivery = await getDelivery(req.params.deliveryId);
  if (!delivery) { res.status(404).json({ success: false, error: 'Delivery not found' }); return; }
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }
  const dest = await getOrCreateDelivery(delivery.subscription_id, parsed.data.to_week);
  const result = await transferDeliveryItem(delivery.id, dest.id, parsed.data.product_id);
  if (!result) { res.status(400).json({ success: false, error: 'Product not in this package' }); return; }
  await logSubscriptionEvent({
    subscriptionId: delivery.subscription_id, deliveryId: delivery.id,
    eventType: 'item_transferred', actorType: 'admin', actorAdminId: req.adminUser?.id ?? null,
    details: { product_id: parsed.data.product_id, from_week: delivery.week_number, to_week: parsed.data.to_week, quantity: result.quantity },
  });
  res.json({ success: true });
});

// ============================================================
// Pause / activate
// ============================================================

const pauseSchema = z.object({ type: z.enum(['temporary', 'permanent']), cycles: z.coerce.number().int().min(1).optional() });

subscriptionsRouter.post('/deliveries/:deliveryId/pause', async (req, res) => {
  const delivery = await getDelivery(req.params.deliveryId);
  if (!delivery) { res.status(404).json({ success: false, error: 'Delivery not found' }); return; }
  const parsed = pauseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }
  await pauseDelivery(delivery, parsed.data.type, parsed.data.cycles);
  await logSubscriptionEvent({
    subscriptionId: delivery.subscription_id, deliveryId: delivery.id,
    eventType: 'delivery_paused', actorType: 'admin', actorAdminId: req.adminUser?.id ?? null,
    details: { type: parsed.data.type, cycles: parsed.data.cycles ?? null, week: delivery.week_number },
  });
  res.json({ success: true });
});

subscriptionsRouter.post('/deliveries/:deliveryId/activate', async (req, res) => {
  const delivery = await getDelivery(req.params.deliveryId);
  if (!delivery) { res.status(404).json({ success: false, error: 'Delivery not found' }); return; }
  const { data: sub } = await supabaseAdmin.from('subscriptions').select('*').eq('id', delivery.subscription_id).maybeSingle();
  if (!sub) { res.status(404).json({ success: false, error: 'Subscription not found' }); return; }
  await reactivateDelivery(delivery, sub as any);
  await logSubscriptionEvent({
    subscriptionId: delivery.subscription_id, deliveryId: delivery.id,
    eventType: 'delivery_reactivated', actorType: 'admin', actorAdminId: req.adminUser?.id ?? null,
    details: { week: delivery.week_number },
  });
  res.json({ success: true });
});

// ============================================================
// Checkout (address / card)
// ============================================================

subscriptionsRouter.get('/:id/checkout', async (req, res) => {
  const { data: sub } = await supabaseAdmin.from('subscriptions').select('*').eq('id', req.params.id).maybeSingle();
  if (!sub) { res.status(404).json({ success: false, error: 'Subscription not found' }); return; }
  const [{ data: addresses }, { data: cards }, { data: address }, { data: card }] = await Promise.all([
    supabaseAdmin.from('addresses').select('*').eq('user_id', sub.user_id).order('is_default', { ascending: false }),
    supabaseAdmin.from('payment_methods').select('id, card_last4, card_brand, card_exp_month, card_exp_year, is_default').eq('user_id', sub.user_id).order('is_default', { ascending: false }),
    sub.subscription_address_id ? supabaseAdmin.from('addresses').select('*').eq('id', sub.subscription_address_id).maybeSingle() : Promise.resolve({ data: null }),
    sub.payment_method_id ? supabaseAdmin.from('payment_methods').select('id, card_last4, card_brand').eq('id', sub.payment_method_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  res.json({ success: true, data: { subscription: sub, address, card, addresses: addresses || [], cards: cards || [] } });
});

const checkoutSchema = z.object({ address_id: z.string().uuid().nullable().optional(), payment_method_id: z.string().uuid().nullable().optional() });

subscriptionsRouter.put('/:id/checkout', async (req, res) => {
  const { data: sub } = await supabaseAdmin.from('subscriptions').select('*').eq('id', req.params.id).maybeSingle();
  if (!sub) { res.status(404).json({ success: false, error: 'Subscription not found' }); return; }
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  if (parsed.data.address_id !== undefined && parsed.data.address_id) {
    await setSubscriptionAddress(sub.id, parsed.data.address_id);
    await logSubscriptionEvent({ subscriptionId: sub.id, eventType: 'address_changed', actorType: 'admin', actorAdminId: req.adminUser?.id ?? null, details: { address_id: parsed.data.address_id } });
  }
  if (parsed.data.payment_method_id !== undefined && parsed.data.payment_method_id) {
    await setSubscriptionCard(sub.id, parsed.data.payment_method_id);
    await logSubscriptionEvent({ subscriptionId: sub.id, eventType: 'card_changed', actorType: 'admin', actorAdminId: req.adminUser?.id ?? null, details: { payment_method_id: parsed.data.payment_method_id } });
  }
  // Admin fixing card/address resolves any open subscription alerts.
  await resolveSubscriptionAlertsForUser(sub.user_id);
  res.json({ success: true });
});

// ============================================================
// History feed (per subscription, optionally filtered by delivery)
// ============================================================

subscriptionsRouter.get('/:id/history', async (req, res) => {
  const deliveryId = req.query.delivery_id as string | undefined;
  let query = supabaseAdmin
    .from('subscription_events')
    .select('*, admin_users(name, email)')
    .eq('subscription_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (deliveryId) query = query.eq('delivery_id', deliveryId);
  const { data, error } = await query;
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }
  res.json({ success: true, data: data || [] });
});

// Order history for a specific weekly delivery (linked orders via runs).
subscriptionsRouter.get('/deliveries/:deliveryId/orders', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('subscription_delivery_runs')
    .select('id, cycle_date, status, order_id, processed_at, total_cents')
    .eq('delivery_id', req.params.deliveryId)
    .not('order_id', 'is', null)
    .order('cycle_date', { ascending: false });
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }
  res.json({ success: true, data: data || [] });
});

// ============================================================
// Alerts for a subscription's user
// ============================================================

subscriptionsRouter.get('/:id/alerts', async (req, res) => {
  const { data: sub } = await supabaseAdmin.from('subscriptions').select('user_id').eq('id', req.params.id).maybeSingle();
  if (!sub) { res.status(404).json({ success: false, error: 'Subscription not found' }); return; }
  const { data } = await supabaseAdmin
    .from('admin_alerts')
    .select('*')
    .eq('user_id', sub.user_id)
    .in('alert_type', SUBSCRIPTION_ALERT_TYPES as unknown as string[])
    .order('created_at', { ascending: false });
  res.json({ success: true, data: data || [] });
});

const manualAlertSchema = z.object({
  week_number: z.coerce.number().int().min(1).max(4),
  admin_note: z.string().trim().max(5000).optional(),
  ivr_message: z.string().trim().max(2000).optional(),
});

subscriptionsRouter.post('/:id/alerts', async (req, res) => {
  const { data: sub } = await supabaseAdmin.from('subscriptions').select('id, user_id').eq('id', req.params.id).maybeSingle();
  if (!sub) { res.status(404).json({ success: false, error: 'Subscription not found' }); return; }
  const parsed = manualAlertSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }
  const delivery = await getOrCreateDelivery(sub.id, parsed.data.week_number);
  const id = await createFailedDeliveryAlert({
    userId: sub.user_id,
    deliveryId: delivery.id,
    weekNumber: parsed.data.week_number,
    issueType: 'other',
    adminNote: parsed.data.admin_note ?? null,
    ivrMessage: parsed.data.ivr_message ?? null,
  });
  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: req.adminUser?.id ?? null,
    action: 'create_manual_subscription_alert',
    entity_type: 'admin_alert',
    entity_id: id,
    changes: parsed.data,
  });
  res.json({ success: true, data: { id } });
});
