import {
  ACTIVE_RETURN_STATUSES,
  ADMIN_ALERT_TYPES,
  HIGH_RETURN_ALERT_THRESHOLD,
  RETURN_WINDOW_DAYS,
  computeProportionalTaxRefundCents,
  isReturnableOrderStatus,
  type HighReturningUserPayload,
} from '@voicex/shared';
import { supabaseAdmin } from './supabase.js';

export interface ReturnableLine {
  order_item_id: string;
  product_id: string | null;
  voicex_id: string;
  product_name: string;
  ordered_qty: number;
  /** Quantity already tied up by active (pending/processing/complete) returns. */
  returned_qty: number;
  /** ordered_qty - returned_qty. */
  remaining_qty: number;
  unit_price_cents: number;
  amazon_price_cents: number;
}

export interface ReturnableOrderInfo {
  id: string;
  user_id: string;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  created_at: string;
}

export interface ReturnableOrder {
  order: ReturnableOrderInfo;
  lines: ReturnableLine[];
  returnableLines: ReturnableLine[];
}

export type ReturnEligibility =
  | { ok: true; data: ReturnableOrder }
  | { ok: false; reason: 'not_found' | 'too_old' | 'not_returnable' | 'fully_returned' };

function isWithinReturnWindow(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const ageMs = Date.now() - created;
  return ageMs <= RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Quantity per order_item already reserved by active returns on this order.
 * Active = pending | processing | complete. Cancelled/rejected/deleted returns
 * release their quantity and are excluded.
 */
export async function getReservedQuantities(orderId: string): Promise<Map<string, number>> {
  const reserved = new Map<string, number>();

  const { data: returns } = await supabaseAdmin
    .from('order_returns')
    .select('id')
    .eq('order_id', orderId)
    .in('status', [...ACTIVE_RETURN_STATUSES]);

  const returnIds = (returns || []).map((r) => r.id);
  if (returnIds.length === 0) return reserved;

  const { data: items } = await supabaseAdmin
    .from('order_return_items')
    .select('order_item_id, quantity')
    .in('return_id', returnIds);

  for (const item of items || []) {
    reserved.set(item.order_item_id, (reserved.get(item.order_item_id) || 0) + item.quantity);
  }

  return reserved;
}

/** Build the returnable view of an order for a specific user, or a rejection reason. */
export async function loadReturnableOrder(
  orderId: string,
  userId: string,
): Promise<ReturnEligibility> {
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, status, subtotal_cents, tax_cents, total_cents, created_at, order_items(*)')
    .eq('id', orderId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'not_found' };
  if (!isReturnableOrderStatus(order.status)) return { ok: false, reason: 'not_returnable' };
  if (!isWithinReturnWindow(order.created_at)) return { ok: false, reason: 'too_old' };

  const reserved = await getReservedQuantities(String(order.id));

  const lines: ReturnableLine[] = (order.order_items || []).map((oi: any) => {
    const returnedQty = reserved.get(oi.id) || 0;
    return {
      order_item_id: oi.id,
      product_id: oi.product_id ?? null,
      voicex_id: oi.voicex_id,
      product_name: oi.product_name,
      ordered_qty: oi.quantity,
      returned_qty: returnedQty,
      remaining_qty: Math.max(0, oi.quantity - returnedQty),
      unit_price_cents: oi.unit_price_cents,
      amazon_price_cents: oi.amazon_price_cents,
    };
  });

  const returnableLines = lines.filter((l) => l.remaining_qty > 0);
  if (returnableLines.length === 0) return { ok: false, reason: 'fully_returned' };

  return {
    ok: true,
    data: {
      order: {
        id: String(order.id),
        user_id: order.user_id,
        status: order.status,
        subtotal_cents: order.subtotal_cents,
        tax_cents: order.tax_cents,
        total_cents: order.total_cents,
        created_at: order.created_at,
      },
      lines,
      returnableLines,
    },
  };
}

export interface ReturnSelection {
  order_item_id: string;
  quantity: number;
}

export interface CreateReturnResult {
  returnId: string;
  itemSubtotalCents: number;
  taxRefundCents: number;
  amazonRefundCents: number;
}

/**
 * Create a return, re-validating remaining quantity server-side so a caller can
 * never return more than what is still available. Seeds the proportional tax
 * refund and Amazon refund; both stay admin-editable afterwards.
 */
export async function createReturn(params: {
  orderId: string;
  userId: string;
  selections: ReturnSelection[];
  source: 'ivr' | 'admin';
}): Promise<CreateReturnResult | null> {
  const eligibility = await loadReturnableOrder(params.orderId, params.userId);
  if (!eligibility.ok) return null;

  const { order, lines } = eligibility.data;
  const lineById = new Map(lines.map((l) => [l.order_item_id, l]));

  const validated: Array<{ line: ReturnableLine; quantity: number }> = [];
  for (const sel of params.selections) {
    const line = lineById.get(sel.order_item_id);
    if (!line) continue;
    const qty = Math.min(sel.quantity, line.remaining_qty);
    if (qty > 0) validated.push({ line, quantity: qty });
  }

  if (validated.length === 0) return null;

  const itemSubtotalCents = validated.reduce((sum, v) => sum + v.line.unit_price_cents * v.quantity, 0);
  const amazonRefundCents = validated.reduce((sum, v) => sum + v.line.amazon_price_cents * v.quantity, 0);
  const taxRefundCents = computeProportionalTaxRefundCents(
    order.tax_cents,
    order.subtotal_cents,
    itemSubtotalCents,
  );

  const { data: created, error: returnErr } = await supabaseAdmin
    .from('order_returns')
    .insert({
      order_id: order.id,
      user_id: order.user_id,
      status: 'pending',
      source: params.source,
      item_subtotal_cents: itemSubtotalCents,
      tax_refund_cents: taxRefundCents,
      amazon_refund_cents: amazonRefundCents,
    })
    .select('id')
    .single();

  if (returnErr || !created) {
    console.error('[returns] Failed to create return:', returnErr?.message);
    return null;
  }

  const returnId = String(created.id);

  const { error: itemsErr } = await supabaseAdmin.from('order_return_items').insert(
    validated.map((v) => ({
      return_id: created.id,
      order_item_id: v.line.order_item_id,
      product_id: v.line.product_id,
      voicex_id: v.line.voicex_id,
      product_name: v.line.product_name,
      quantity: v.quantity,
      unit_price_cents: v.line.unit_price_cents,
      amazon_price_cents: v.line.amazon_price_cents,
    })),
  );

  if (itemsErr) {
    console.error('[returns] Failed to insert return items, rolling back header:', itemsErr.message);
    await supabaseAdmin.from('order_returns').delete().eq('id', created.id);
    return null;
  }

  await supabaseAdmin.from('order_events').insert({
    order_id: order.id,
    status: order.status,
    source: params.source === 'ivr' ? 'system' : 'admin',
    details: { action: 'return_created', return_id: returnId, item_subtotal_cents: itemSubtotalCents },
  });

  await refreshUserReturnState(order.user_id);

  return { returnId, itemSubtotalCents, taxRefundCents, amazonRefundCents };
}

/** Count of active (non-void) returns for a user — used for the Users column and alerts. */
export async function getUserActiveReturnCount(userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('order_returns')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', [...ACTIVE_RETURN_STATUSES]);
  return count ?? 0;
}

/**
 * Recompute the maintained users.returns_count and refresh the high-return
 * alert. Call after any change that affects a user's active return count.
 */
export async function refreshUserReturnState(userId: string): Promise<void> {
  const count = await getUserActiveReturnCount(userId);
  await supabaseAdmin.from('users').update({ returns_count: count }).eq('id', userId);
  await syncHighReturningUserAlert(userId, count);
}

/**
 * Create / refresh / resolve the High Returning User alert for a user based on
 * their active return count crossing HIGH_RETURN_ALERT_THRESHOLD (more than 5).
 */
export async function syncHighReturningUserAlert(userId: string, knownCount?: number): Promise<void> {
  const count = knownCount ?? (await getUserActiveReturnCount(userId));

  const { data: existing } = await supabaseAdmin
    .from('admin_alerts')
    .select('id, status')
    .eq('entity_type', 'user')
    .eq('entity_id', userId)
    .eq('alert_type', ADMIN_ALERT_TYPES.HIGH_RETURNING_USER)
    .maybeSingle();

  if (count <= HIGH_RETURN_ALERT_THRESHOLD) {
    if (existing && existing.status !== 'resolved') {
      await supabaseAdmin
        .from('admin_alerts')
        .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return;
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('name')
    .eq('id', userId)
    .maybeSingle();

  const payload: HighReturningUserPayload = {
    user_id: userId,
    user_name: user?.name ?? null,
    return_count: count,
  };
  const title = 'High returning user';
  const message = `This customer has made ${count} returns.`;

  if (!existing) {
    await supabaseAdmin.from('admin_alerts').insert({
      alert_type: ADMIN_ALERT_TYPES.HIGH_RETURNING_USER,
      status: 'new',
      entity_type: 'user',
      entity_id: userId,
      product_id: null,
      title,
      message,
      payload,
    });
    return;
  }

  await supabaseAdmin
    .from('admin_alerts')
    .update({
      status: existing.status === 'resolved' ? 'new' : existing.status,
      resolved_at: null,
      title,
      message,
      payload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);
}
