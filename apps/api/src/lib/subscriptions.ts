/**
 * Subscription domain helpers shared by the IVR handlers, the admin API, and the
 * processing engine. Pure-ish data access + business rules; no Express/TelTech.
 */
import { supabaseAdmin } from './supabase.js';
import {
  getProductDisplayName,
  getProductPriceCents,
  processingDayForWeek,
  SUBSCRIPTION_TIMEZONE,
  SUBSCRIPTION_WEEKS,
  SETTING_KEYS,
} from '@voicex/shared';
import type {
  CatalogProduct,
  SubscriptionEventActor,
} from '@voicex/shared';

// ============================================================
// ET date helpers (processing is anchored to America/New_York)
// ============================================================

export interface EtClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
}

export function etClock(now: Date = new Date()): EtClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SUBSCRIPTION_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || '0');
  // Intl can emit hour "24" at midnight in some environments; normalize to 0.
  const hour = get('hour') % 24;
  return { year: get('year'), month: get('month'), day: get('day'), hour };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Today's date in ET as YYYY-MM-DD. */
export function etToday(now: Date = new Date()): string {
  const c = etClock(now);
  return ymd(c.year, c.month, c.day);
}

/**
 * Next processing date (YYYY-MM-DD, ET calendar) for a given week, strictly
 * after today. If today's ET date is already on/after the week's processing day,
 * the next occurrence is next month (this month's run has happened at midnight).
 */
export function computeNextProcessingDate(week: number, now: Date = new Date()): string {
  const day = processingDayForWeek(week);
  const c = etClock(now);
  let year = c.year;
  let month = c.month;
  if (c.day >= day) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return ymd(year, month, day);
}

/** Add N months to a cycle date, keeping the week's fixed processing day. */
export function addMonthsToCycleDate(cycleDate: string, months: number, week: number): string {
  const [y, m] = cycleDate.split('-').map(Number);
  const day = processingDayForWeek(week);
  let year = y;
  let month = m + months;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return ymd(year, month, day);
}

// ============================================================
// Subscription / delivery accessors
// ============================================================

export interface SubscriptionRow {
  id: string;
  user_id: string;
  subscription_address_id: string | null;
  payment_method_id: string | null;
  terms_explanation_count: number;
  terms_accepted_at: string | null;
}

export async function getSubscriptionByUser(userId: string): Promise<SubscriptionRow | null> {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as SubscriptionRow) || null;
}

export async function getOrCreateSubscription(userId: string): Promise<SubscriptionRow> {
  const existing = await getSubscriptionByUser(userId);
  if (existing) return existing;

  // Seed the subscription address/card from the user's defaults if present.
  const [{ data: addr }, { data: card }] = await Promise.all([
    supabaseAdmin.from('addresses').select('id').eq('user_id', userId).order('is_default', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('payment_methods').select('id').eq('user_id', userId).order('is_default', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .insert({
      user_id: userId,
      subscription_address_id: addr?.id ?? null,
      payment_method_id: card?.id ?? null,
    })
    .select('*')
    .single();

  if (error || !data) {
    // Lost a create race; re-read.
    const again = await getSubscriptionByUser(userId);
    if (again) return again;
    throw new Error(`Failed to create subscription: ${error?.message}`);
  }
  return data as SubscriptionRow;
}

export interface DeliveryRow {
  id: string;
  subscription_id: string;
  week_number: number;
  status: 'active' | 'temp_paused' | 'perm_paused';
  pause_type: 'temporary' | 'permanent' | null;
  paused_cycles: number | null;
  pause_resume_date: string | null;
  paused_at: string | null;
  next_cycle_date: string | null;
}

export async function getDeliveries(subscriptionId: string): Promise<DeliveryRow[]> {
  const { data } = await supabaseAdmin
    .from('subscription_deliveries')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .order('week_number', { ascending: true });
  return (data as DeliveryRow[]) || [];
}

export async function getDelivery(deliveryId: string): Promise<DeliveryRow | null> {
  const { data } = await supabaseAdmin
    .from('subscription_deliveries')
    .select('*')
    .eq('id', deliveryId)
    .maybeSingle();
  return (data as DeliveryRow) || null;
}

export async function getOrCreateDelivery(subscriptionId: string, week: number): Promise<DeliveryRow> {
  const { data: existing } = await supabaseAdmin
    .from('subscription_deliveries')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .eq('week_number', week)
    .maybeSingle();
  if (existing) return existing as DeliveryRow;

  const { data, error } = await supabaseAdmin
    .from('subscription_deliveries')
    .insert({
      subscription_id: subscriptionId,
      week_number: week,
      status: 'active',
      next_cycle_date: computeNextProcessingDate(week),
    })
    .select('*')
    .single();

  if (error || !data) {
    const { data: again } = await supabaseAdmin
      .from('subscription_deliveries')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .eq('week_number', week)
      .maybeSingle();
    if (again) return again as DeliveryRow;
    throw new Error(`Failed to create delivery: ${error?.message}`);
  }
  return data as DeliveryRow;
}

export async function getDeliveryByWeekForUser(userId: string, week: number): Promise<DeliveryRow | null> {
  const sub = await getSubscriptionByUser(userId);
  if (!sub) return null;
  const { data } = await supabaseAdmin
    .from('subscription_deliveries')
    .select('*')
    .eq('subscription_id', sub.id)
    .eq('week_number', week)
    .maybeSingle();
  return (data as DeliveryRow) || null;
}

// ============================================================
// Package items
// ============================================================

export interface DeliveryItemRow {
  id: string;
  delivery_id: string;
  product_id: string;
  quantity: number;
  catalog_products?: CatalogProduct;
}

export async function getDeliveryItems(deliveryId: string): Promise<DeliveryItemRow[]> {
  const { data } = await supabaseAdmin
    .from('subscription_delivery_items')
    .select('*, catalog_products(*)')
    .eq('delivery_id', deliveryId)
    .order('created_at', { ascending: true });
  return (data as DeliveryItemRow[]) || [];
}

export async function findDeliveryItem(deliveryId: string, productId: string): Promise<DeliveryItemRow | null> {
  const { data } = await supabaseAdmin
    .from('subscription_delivery_items')
    .select('*, catalog_products(*)')
    .eq('delivery_id', deliveryId)
    .eq('product_id', productId)
    .maybeSingle();
  return (data as DeliveryItemRow) || null;
}

/** Add a product to a package, or set its quantity if already present. */
export async function setDeliveryItemQuantity(
  deliveryId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  const existing = await findDeliveryItem(deliveryId, productId);
  if (existing) {
    await supabaseAdmin
      .from('subscription_delivery_items')
      .update({ quantity })
      .eq('id', existing.id);
    return;
  }
  await supabaseAdmin
    .from('subscription_delivery_items')
    .insert({ delivery_id: deliveryId, product_id: productId, quantity });
}

export async function removeDeliveryItem(deliveryId: string, productId: string): Promise<void> {
  await supabaseAdmin
    .from('subscription_delivery_items')
    .delete()
    .eq('delivery_id', deliveryId)
    .eq('product_id', productId);
}

export async function clearDeliveryPackage(deliveryId: string): Promise<void> {
  await supabaseAdmin
    .from('subscription_delivery_items')
    .delete()
    .eq('delivery_id', deliveryId);
}

/**
 * Move a product from one delivery package to another. If the destination
 * already has the product, quantities are summed (the spec only offers
 * destinations that don't already contain it, but we guard anyway).
 */
export async function transferDeliveryItem(
  fromDeliveryId: string,
  toDeliveryId: string,
  productId: string,
): Promise<{ quantity: number } | null> {
  const source = await findDeliveryItem(fromDeliveryId, productId);
  if (!source) return null;
  const dest = await findDeliveryItem(toDeliveryId, productId);
  const newQty = (dest?.quantity || 0) + source.quantity;
  await setDeliveryItemQuantity(toDeliveryId, productId, newQty);
  await removeDeliveryItem(fromDeliveryId, productId);
  return { quantity: source.quantity };
}

// ============================================================
// Pricing
// ============================================================

let cachedMarkup: { value: number; at: number } | null = null;

export async function getDefaultMarkupPercent(): Promise<number> {
  if (cachedMarkup && Date.now() - cachedMarkup.at < 60_000) return cachedMarkup.value;
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', SETTING_KEYS.DEFAULT_MARKUP_PERCENT)
    .maybeSingle();
  const value = Number(data?.value ?? '15');
  cachedMarkup = { value: Number.isFinite(value) ? value : 15, at: Date.now() };
  return cachedMarkup.value;
}

export interface PricedLine {
  product_id: string;
  product: CatalogProduct;
  voicex_id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  amazon_price_cents: number;
  line_total_cents: number;
}

export interface PricedPackage {
  lines: PricedLine[];
  subtotal_cents: number;
  total_products: number; // distinct products
  total_quantity: number;
}

export async function priceDeliveryItems(
  items: DeliveryItemRow[],
  isWhitelisted: boolean,
): Promise<PricedPackage> {
  const markup = await getDefaultMarkupPercent();
  const lines: PricedLine[] = [];
  let subtotal = 0;
  let totalQty = 0;
  for (const item of items) {
    const product = item.catalog_products;
    if (!product) continue;
    const unit = getProductPriceCents(product, markup, isWhitelisted) ?? 0;
    const lineTotal = unit * item.quantity;
    subtotal += lineTotal;
    totalQty += item.quantity;
    lines.push({
      product_id: item.product_id,
      product,
      voicex_id: product.voicex_id,
      product_name: getProductDisplayName(product),
      quantity: item.quantity,
      unit_price_cents: unit,
      amazon_price_cents: product.amazon_price_cents ?? 0,
      line_total_cents: lineTotal,
    });
  }
  return {
    lines,
    subtotal_cents: subtotal,
    total_products: lines.length,
    total_quantity: totalQty,
  };
}

// ============================================================
// Events (append-only history feed)
// ============================================================

export interface LogEventInput {
  subscriptionId: string;
  deliveryId?: string | null;
  runId?: string | null;
  eventType: string;
  actorType?: SubscriptionEventActor;
  actorAdminId?: string | null;
  details?: Record<string, unknown> | null;
}

export async function logSubscriptionEvent(input: LogEventInput): Promise<void> {
  await supabaseAdmin.from('subscription_events').insert({
    subscription_id: input.subscriptionId,
    delivery_id: input.deliveryId ?? null,
    run_id: input.runId ?? null,
    event_type: input.eventType,
    actor_type: input.actorType ?? 'system',
    actor_admin_id: input.actorAdminId ?? null,
    details: input.details ?? null,
  });
}

// ============================================================
// Terms / explanation tracking (per user)
// ============================================================

export async function recordTermsExplanationPlayed(subscriptionId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('terms_explanation_count')
    .eq('id', subscriptionId)
    .maybeSingle();
  const next = (data?.terms_explanation_count ?? 0) + 1;
  await supabaseAdmin
    .from('subscriptions')
    .update({
      terms_explanation_count: next,
      terms_accepted_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);
  return next;
}

// ============================================================
// Run scheduling helpers
// ============================================================

/** A delivery is processable only if active, has >=1 item, an address, and a card. */
export interface ProcessabilityResult {
  processable: boolean;
  hasItems: boolean;
  hasAddress: boolean;
  hasCard: boolean;
  isActive: boolean;
}

export async function checkDeliveryProcessable(
  delivery: DeliveryRow,
  subscription: SubscriptionRow,
): Promise<ProcessabilityResult> {
  const items = await getDeliveryItems(delivery.id);
  const isActive = delivery.status === 'active';
  const hasItems = items.length > 0;
  const hasAddress = !!subscription.subscription_address_id;
  const hasCard = !!subscription.payment_method_id;
  return {
    processable: isActive && hasItems && hasAddress && hasCard,
    hasItems,
    hasAddress,
    hasCard,
    isActive,
  };
}

/** Recompute and persist a delivery's next_cycle_date from its open runs. */
export async function recomputeNextCycleDate(delivery: DeliveryRow): Promise<string | null> {
  if (delivery.status === 'perm_paused') {
    await supabaseAdmin.from('subscription_deliveries').update({ next_cycle_date: null }).eq('id', delivery.id);
    return null;
  }
  const { data: openRun } = await supabaseAdmin
    .from('subscription_delivery_runs')
    .select('cycle_date')
    .eq('delivery_id', delivery.id)
    .in('status', ['pending', 'issue', 'locked', 'processing'])
    .order('cycle_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  let next = openRun?.cycle_date as string | undefined;
  if (!next) {
    next = computeNextProcessingDate(delivery.week_number);
    // If temporarily paused, the next real cycle is at/after the resume date.
    if (delivery.status === 'temp_paused' && delivery.pause_resume_date && delivery.pause_resume_date > next) {
      next = delivery.pause_resume_date;
    }
  }
  await supabaseAdmin.from('subscription_deliveries').update({ next_cycle_date: next }).eq('id', delivery.id);
  return next;
}

/**
 * Create the single upcoming pending run for an active, processable delivery
 * (idempotent on delivery_id + cycle_date). Returns the cycle date used, or null
 * if the delivery is not eligible.
 */
export async function ensureUpcomingRun(
  delivery: DeliveryRow,
  subscription: SubscriptionRow,
): Promise<string | null> {
  if (delivery.status !== 'active') return null;
  const check = await checkDeliveryProcessable(delivery, subscription);
  if (!check.processable) return null;

  const cycleDate = computeNextProcessingDate(delivery.week_number);

  const { data: existing } = await supabaseAdmin
    .from('subscription_delivery_runs')
    .select('id')
    .eq('delivery_id', delivery.id)
    .eq('cycle_date', cycleDate)
    .maybeSingle();
  if (existing) return cycleDate;

  await supabaseAdmin.from('subscription_delivery_runs').insert({
    delivery_id: delivery.id,
    subscription_id: subscription.id,
    user_id: subscription.user_id,
    week_number: delivery.week_number,
    cycle_date: cycleDate,
    status: 'pending',
    scheduled_at: cycleDateToEtMidnightIso(cycleDate),
  });
  await supabaseAdmin
    .from('subscription_deliveries')
    .update({ next_cycle_date: cycleDate })
    .eq('id', delivery.id);
  return cycleDate;
}

/** Approximate the ET-midnight instant of a cycle date as an ISO timestamp. */
export function cycleDateToEtMidnightIso(cycleDate: string): string {
  // ET is UTC-5 (EST) or UTC-4 (EDT). Use a fixed -05:00 offset for the estimate;
  // the exact instant is not critical (only the calendar cycle_date is binding).
  return `${cycleDate}T05:00:00.000Z`;
}

/** Delete not-yet-locked (pending/issue) runs for a delivery (e.g. when paused). */
export async function dropOpenRunsForDelivery(deliveryId: string): Promise<void> {
  await supabaseAdmin
    .from('subscription_delivery_runs')
    .delete()
    .eq('delivery_id', deliveryId)
    .in('status', ['pending', 'issue']);
}

/** Pause a delivery (temporary for N cycles, or permanent). Drops open runs. */
export async function pauseDelivery(
  delivery: DeliveryRow,
  type: 'temporary' | 'permanent',
  cycles?: number,
): Promise<void> {
  await dropOpenRunsForDelivery(delivery.id);
  if (type === 'permanent') {
    await supabaseAdmin
      .from('subscription_deliveries')
      .update({
        status: 'perm_paused',
        pause_type: 'permanent',
        paused_cycles: null,
        pause_resume_date: null,
        paused_at: new Date().toISOString(),
        next_cycle_date: null,
      })
      .eq('id', delivery.id);
    return;
  }
  const n = cycles && cycles > 0 ? cycles : 1;
  const next = computeNextProcessingDate(delivery.week_number);
  const resume = addMonthsToCycleDate(next, n, delivery.week_number);
  await supabaseAdmin
    .from('subscription_deliveries')
    .update({
      status: 'temp_paused',
      pause_type: 'temporary',
      paused_cycles: n,
      pause_resume_date: resume,
      paused_at: new Date().toISOString(),
      next_cycle_date: resume,
    })
    .eq('id', delivery.id);
}

/** Reactivate a paused delivery and re-seed its upcoming run. */
export async function reactivateDelivery(
  delivery: DeliveryRow,
  subscription: SubscriptionRow,
): Promise<void> {
  await supabaseAdmin
    .from('subscription_deliveries')
    .update({
      status: 'active',
      pause_type: null,
      paused_cycles: null,
      pause_resume_date: null,
      paused_at: null,
    })
    .eq('id', delivery.id);
  const fresh = await getDelivery(delivery.id);
  if (fresh) {
    await ensureUpcomingRun(fresh, subscription);
    await recomputeNextCycleDate(fresh);
  }
}

export async function setSubscriptionAddress(subscriptionId: string, addressId: string): Promise<void> {
  await supabaseAdmin.from('subscriptions').update({ subscription_address_id: addressId }).eq('id', subscriptionId);
}

export async function setSubscriptionCard(subscriptionId: string, paymentMethodId: string): Promise<void> {
  await supabaseAdmin.from('subscriptions').update({ payment_method_id: paymentMethodId }).eq('id', subscriptionId);
}

/** Ensure upcoming runs for every eligible delivery of every subscription. */
export async function ensureAllUpcomingRuns(): Promise<{ created: number }> {
  let created = 0;
  const { data: subs } = await supabaseAdmin.from('subscriptions').select('*');
  for (const sub of (subs as SubscriptionRow[]) || []) {
    const deliveries = await getDeliveries(sub.id);
    for (const d of deliveries) {
      const cycle = await ensureUpcomingRun(d, sub);
      if (cycle) created += 1;
    }
  }
  return { created };
}

export const SUBSCRIPTION_WEEK_NUMBERS = SUBSCRIPTION_WEEKS;
