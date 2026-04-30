import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { solaCapture, solaVoidRelease } from '../../lib/sola.js';
import { logCheckoutEvent, type CheckoutEventType } from '../../lib/checkout-logger.js';
import { etaInputArraySchema, replaceOrderFulfillmentEtas, sortOrderFulfillmentEtas } from './order-etas.js';

export const fulfillmentRouter = Router();

const PROVIDERS = ['rye', 'manual'] as const;
const MANUAL_ORDER_SELECT = '*, users(name, email), addresses(*), order_items(*), order_holds(*), order_fulfillment_etas(*)';

const providerSchema = z.object({
  provider: z.enum(PROVIDERS),
});

const markOrderedSchema = z.object({
  external_order_id: z.string().trim().min(1, 'Amazon order number is required').max(200),
  fulfillment_notes: z.string().trim().max(10000).optional(),
  etas: etaInputArraySchema.optional(),
});

const notesSchema = z.object({
  fulfillment_notes: z.string().trim().max(10000).optional(),
});

async function getSetting(key: string, fallback: string) {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  return data?.value || fallback;
}

async function setSetting(key: string, value: string, adminUserId: string | undefined) {
  const { data, error } = await supabaseAdmin
    .from('settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || `Failed to update ${key}`);

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: adminUserId ?? null,
    action: 'update_fulfillment_provider',
    entity_type: 'setting',
    entity_id: key,
    changes: { value },
  });

  return data;
}

async function loadManualOrder(orderId: string) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(MANUAL_ORDER_SELECT)
    .eq('id', orderId)
    .single();

  if (error || !data) return null;
  return sortOrderFulfillmentEtas(data as any);
}

function getHeldHold(order: any) {
  return (order.order_holds || []).find((h: any) => h.status === 'held') || null;
}

async function logAdminAudit(adminUserId: string | undefined, action: string, orderId: string, changes: Record<string, unknown>) {
  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: adminUserId ?? null,
    action,
    entity_type: 'order',
    entity_id: orderId,
    changes,
  });
}

async function logOrderEvent(orderId: string, status: string, action: string, details: Record<string, unknown>) {
  await supabaseAdmin.from('order_events').insert({
    order_id: orderId,
    status,
    source: 'admin',
    details: { action, ...details },
  });
}

async function logCheckoutForOrder(
  orderId: string,
  eventType: CheckoutEventType,
  severity: 'info' | 'warn' | 'error',
  details: Record<string, unknown>
) {
  const { data } = await supabaseAdmin
    .from('checkout_events')
    .select('call_sid, user_id')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data?.call_sid) return;

  await logCheckoutEvent({
    callSid: data.call_sid,
    userId: data.user_id ?? null,
    orderId,
    eventType,
    severity,
    details,
  });
}

function ensureManualOrder(order: any, res: any) {
  if (!order) {
    res.status(404).json({ success: false, error: 'Order not found' });
    return false;
  }
  if (order.fulfillment_provider !== 'manual') {
    res.status(400).json({ success: false, error: 'Only manual fulfillment orders can be updated here.' });
    return false;
  }
  return true;
}

fulfillmentRouter.get('/provider', async (_req, res) => {
  const [activeProvider, amazonAssociateTag] = await Promise.all([
    getSetting('active_fulfillment_provider', 'rye'),
    getSetting('amazon_associate_tag', 'voicexshop20-20'),
  ]);

  res.json({
    success: true,
    data: {
      active_provider: activeProvider === 'manual' ? 'manual' : 'rye',
      providers: PROVIDERS,
      amazon_associate_tag: amazonAssociateTag,
    },
  });
});

fulfillmentRouter.patch('/provider', async (req, res) => {
  const parsed = providerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid provider' });
    return;
  }

  try {
    const data = await setSetting('active_fulfillment_provider', parsed.data.provider, req.adminUser?.id);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to update provider' });
  }
});

fulfillmentRouter.get('/manual-queue', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(MANUAL_ORDER_SELECT)
    .eq('fulfillment_provider', 'manual')
    .in('fulfillment_status', ['queued', 'needs_review'])
    .order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data: (data || []).map((order: any) => sortOrderFulfillmentEtas(order)) });
});

fulfillmentRouter.get('/manual-queue/count', async (_req, res) => {
  const { count, error } = await supabaseAdmin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('fulfillment_provider', 'manual')
    .in('fulfillment_status', ['queued', 'needs_review']);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data: { count: count || 0 } });
});

fulfillmentRouter.post('/manual-queue/:orderId/mark-ordered', async (req, res) => {
  const parsed = markOrderedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' });
    return;
  }

  const order = await loadManualOrder(req.params.orderId);
  if (!ensureManualOrder(order, res)) return;

  if (order.fulfillment_status === 'ordered') {
    res.json({ success: true, data: order });
    return;
  }

  const hold = getHeldHold(order);
  if (!hold) {
    res.status(409).json({ success: false, error: 'No active Sola authorization hold was found for this order.' });
    return;
  }

  try {
    if (parsed.data.etas) {
      await replaceOrderFulfillmentEtas(order.id, parsed.data.etas, req.adminUser?.id);
    }

    const capture = await solaCapture(hold.sola_ref_num, hold.amount_cents);
    if (capture.xResult !== 'A') {
      throw new Error(capture.xError || 'Sola capture was declined');
    }

    await supabaseAdmin
      .from('order_holds')
      .update({ status: 'captured' })
      .eq('id', hold.id)
      .eq('status', 'held');

    const updates = {
      status: 'completed',
      fulfillment_status: 'ordered',
      external_order_id: parsed.data.external_order_id,
      fulfillment_notes: parsed.data.fulfillment_notes || order.fulfillment_notes || null,
      fulfilled_by: req.adminUser?.id ?? null,
      fulfilled_at: new Date().toISOString(),
    };

    const { data: updated, error } = await supabaseAdmin
      .from('orders')
      .update(updates)
      .eq('id', order.id)
      .select(MANUAL_ORDER_SELECT)
      .single();

    if (error || !updated) throw new Error(error?.message || 'Failed to update order');

    await logOrderEvent(order.id, 'completed', 'manual_fulfillment_marked_ordered', {
      external_order_id: parsed.data.external_order_id,
      sola_ref_num: hold.sola_ref_num,
      amount_cents: hold.amount_cents,
      etas: parsed.data.etas ?? null,
    });
    await logAdminAudit(req.adminUser?.id, 'manual_fulfillment_mark_ordered', order.id, {
      ...updates,
      etas: parsed.data.etas ?? null,
    });
    await logCheckoutForOrder(order.id, 'manual_capture_succeeded', 'info', {
      order_id: order.id,
      external_order_id: parsed.data.external_order_id,
      sola_ref_num: hold.sola_ref_num,
      amount_cents: hold.amount_cents,
    });
    await logCheckoutForOrder(order.id, 'manual_fulfillment_marked_ordered', 'info', {
      order_id: order.id,
      external_order_id: parsed.data.external_order_id,
    });

    for (const item of order.order_items || []) {
      await supabaseAdmin.rpc('increment_product_sold', {
        p_product_id: item.product_id,
        p_qty: item.quantity,
      });
    }

    res.json({ success: true, data: sortOrderFulfillmentEtas(updated as any) });
  } catch (error: any) {
    console.error('[manual fulfillment] capture failed:', error);
    await supabaseAdmin.from('order_holds').update({ status: 'failed' }).eq('id', hold.id).eq('status', 'held');
    await supabaseAdmin
      .from('orders')
      .update({
        fulfillment_status: 'needs_review',
        fulfillment_notes: parsed.data.fulfillment_notes || order.fulfillment_notes || 'Sola capture failed during manual fulfillment.',
      })
      .eq('id', order.id);
    await logOrderEvent(order.id, 'processing', 'manual_capture_failed', {
      external_order_id: parsed.data.external_order_id,
      sola_ref_num: hold.sola_ref_num,
      amount_cents: hold.amount_cents,
      error: error?.message || String(error),
    });
    await logCheckoutForOrder(order.id, 'manual_capture_failed', 'error', {
      order_id: order.id,
      external_order_id: parsed.data.external_order_id,
      sola_ref_num: hold.sola_ref_num,
      amount_cents: hold.amount_cents,
      error: error?.message || String(error),
    });
    res.status(502).json({ success: false, error: error?.message || 'Sola capture failed' });
  }
});

fulfillmentRouter.post('/manual-queue/:orderId/cancel', async (req, res) => {
  const parsed = notesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' });
    return;
  }

  const order = await loadManualOrder(req.params.orderId);
  if (!ensureManualOrder(order, res)) return;

  if (order.fulfillment_status === 'cancelled') {
    res.json({ success: true, data: order });
    return;
  }

  const hold = getHeldHold(order);
  if (!hold) {
    res.status(409).json({ success: false, error: 'No active Sola authorization hold was found for this order.' });
    return;
  }

  try {
    const voidResult = await solaVoidRelease(hold.sola_ref_num);
    if (voidResult.xResult !== 'A') {
      throw new Error(voidResult.xError || 'Sola void/release was declined');
    }

    await supabaseAdmin.from('order_holds').update({ status: 'voided' }).eq('id', hold.id).eq('status', 'held');

    const updates = {
      status: 'cancelled',
      fulfillment_status: 'cancelled',
      fulfillment_notes: parsed.data.fulfillment_notes || order.fulfillment_notes || null,
      fulfilled_by: req.adminUser?.id ?? null,
      fulfilled_at: new Date().toISOString(),
    };

    const { data: updated, error } = await supabaseAdmin
      .from('orders')
      .update(updates)
      .eq('id', order.id)
      .select(MANUAL_ORDER_SELECT)
      .single();

    if (error || !updated) throw new Error(error?.message || 'Failed to update order');

    await logOrderEvent(order.id, 'cancelled', 'manual_fulfillment_cancelled', {
      sola_ref_num: hold.sola_ref_num,
      amount_cents: hold.amount_cents,
    });
    await logAdminAudit(req.adminUser?.id, 'manual_fulfillment_cancel', order.id, updates);
    await logCheckoutForOrder(order.id, 'manual_void_release', 'info', {
      order_id: order.id,
      sola_ref_num: hold.sola_ref_num,
      amount_cents: hold.amount_cents,
    });
    await logCheckoutForOrder(order.id, 'manual_fulfillment_cancelled', 'warn', {
      order_id: order.id,
      reason: parsed.data.fulfillment_notes || null,
    });

    res.json({ success: true, data: sortOrderFulfillmentEtas(updated as any) });
  } catch (error: any) {
    console.error('[manual fulfillment] void release failed:', error);
    await supabaseAdmin.from('order_holds').update({ status: 'failed' }).eq('id', hold.id).eq('status', 'held');
    await supabaseAdmin
      .from('orders')
      .update({
        fulfillment_status: 'needs_review',
        fulfillment_notes: parsed.data.fulfillment_notes || order.fulfillment_notes || 'Sola void/release failed during manual fulfillment.',
      })
      .eq('id', order.id);
    await logOrderEvent(order.id, 'processing', 'manual_void_release_failed', {
      sola_ref_num: hold.sola_ref_num,
      amount_cents: hold.amount_cents,
      error: error?.message || String(error),
    });
    await logCheckoutForOrder(order.id, 'manual_void_release', 'error', {
      order_id: order.id,
      sola_ref_num: hold.sola_ref_num,
      amount_cents: hold.amount_cents,
      error: error?.message || String(error),
    });
    res.status(502).json({ success: false, error: error?.message || 'Sola void/release failed' });
  }
});

fulfillmentRouter.post('/manual-queue/:orderId/needs-review', async (req, res) => {
  const parsed = notesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' });
    return;
  }

  const order = await loadManualOrder(req.params.orderId);
  if (!ensureManualOrder(order, res)) return;

  const updates = {
    fulfillment_status: 'needs_review',
    fulfillment_notes: parsed.data.fulfillment_notes || order.fulfillment_notes || null,
  };

  const { data: updated, error } = await supabaseAdmin
    .from('orders')
    .update(updates)
    .eq('id', order.id)
    .select(MANUAL_ORDER_SELECT)
    .single();

  if (error || !updated) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to update order' });
    return;
  }

  await logOrderEvent(order.id, order.status, 'manual_fulfillment_needs_review', {
    notes: updates.fulfillment_notes,
  });
  await logAdminAudit(req.adminUser?.id, 'manual_fulfillment_needs_review', order.id, updates);
  await logCheckoutForOrder(order.id, 'manual_fulfillment_needs_review', 'warn', {
    order_id: order.id,
    notes: updates.fulfillment_notes,
  });

  res.json({ success: true, data: sortOrderFulfillmentEtas(updated as any) });
});
