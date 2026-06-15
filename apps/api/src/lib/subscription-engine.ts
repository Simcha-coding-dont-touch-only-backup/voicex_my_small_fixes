/**
 * Subscription processing engine: lock/snapshot, 24h pre-run check, charge +
 * manual order creation, and the in-process time-spaced worker. Manual
 * fulfillment only; the charge+fulfill step is isolated in `processRun` so an
 * Amazon provider can slot in later.
 */
import { supabaseAdmin } from './supabase.js';
import { solaSaleRecurring } from './sola.js';
import { calculateManualPricing } from './manual-pricing.js';
import { getProductDisplayName, getProductPriceCents, SUBSCRIPTION_ALERT_ISSUE_TYPES } from '@voicex/shared';
import {
  etClock,
  etToday,
  getDeliveryItems,
  getDefaultMarkupPercent,
  logSubscriptionEvent,
  ensureUpcomingRun,
  recomputeNextCycleDate,
  getDelivery,
  getSubscriptionByUser,
} from './subscriptions.js';
import type { DeliveryRow, SubscriptionRow } from './subscriptions.js';
import {
  createDeliveryIssueAlert,
  createFailedDeliveryAlert,
} from './subscription-alerts.js';
import { config } from '../config.js';

const ISSUE = SUBSCRIPTION_ALERT_ISSUE_TYPES;

interface RunRow {
  id: string;
  delivery_id: string;
  subscription_id: string;
  user_id: string;
  week_number: number;
  cycle_date: string;
  status: string;
  attempt_count: number;
  order_id: string | null;
}

function isCardExpired(card: { card_exp_month: number; card_exp_year: number } | null): boolean {
  if (!card) return false;
  if (!card.card_exp_year || !card.card_exp_month) return false;
  const c = etClock();
  if (card.card_exp_year < c.year) return true;
  if (card.card_exp_year === c.year && card.card_exp_month < c.month) return true;
  return false;
}

async function loadUserWhitelist(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('users').select('is_whitelisted').eq('id', userId).maybeSingle();
  return !!data?.is_whitelisted;
}

/**
 * Snapshot the live package into run_items at lock time. Products that are no
 * longer enabled are recorded as skipped_disabled (and raise a Delivery Issue
 * alert). Returns whether anything is left to ship.
 */
async function snapshotPackage(
  run: RunRow,
  isWhitelisted: boolean,
): Promise<{ includedSubtotal: number; includedCount: number; skippedCount: number }> {
  const items = await getDeliveryItems(run.delivery_id);
  const markup = await getDefaultMarkupPercent();
  let includedSubtotal = 0;
  let includedCount = 0;
  let skippedCount = 0;

  // Clear any prior snapshot (e.g. on retry re-lock).
  await supabaseAdmin.from('subscription_delivery_run_items').delete().eq('run_id', run.id);

  for (const item of items) {
    const product = item.catalog_products;
    if (!product) continue;
    const disabled = product.status !== 'active';
    const unit = getProductPriceCents(product, markup, isWhitelisted) ?? 0;
    if (disabled) {
      skippedCount += 1;
      await supabaseAdmin.from('subscription_delivery_run_items').insert({
        run_id: run.id,
        product_id: item.product_id,
        voicex_id: product.voicex_id,
        product_name: getProductDisplayName(product),
        quantity: 0,
        original_quantity: item.quantity,
        unit_price_cents: unit,
        amazon_price_cents: product.amazon_price_cents ?? 0,
        status: 'skipped_disabled',
        reason: `Product status is ${product.status}`,
      });
      await createDeliveryIssueAlert({
        userId: run.user_id,
        deliveryId: run.delivery_id,
        weekNumber: run.week_number,
        runId: run.id,
        cycleDate: run.cycle_date,
        issueType: ISSUE.PRODUCT_DISABLED,
        adminNote: `${getProductDisplayName(product)} is disabled and was skipped.`,
      });
      continue;
    }
    includedCount += 1;
    includedSubtotal += unit * item.quantity;
    await supabaseAdmin.from('subscription_delivery_run_items').insert({
      run_id: run.id,
      product_id: item.product_id,
      voicex_id: product.voicex_id,
      product_name: getProductDisplayName(product),
      quantity: item.quantity,
      original_quantity: item.quantity,
      unit_price_cents: unit,
      amazon_price_cents: product.amazon_price_cents ?? 0,
      status: 'included',
    });
  }
  return { includedSubtotal, includedCount, skippedCount };
}

// ============================================================
// 24h pre-run check
// ============================================================

/**
 * Evaluate pending/issue runs whose cycle_date is within the next ~2 days.
 * Card-expiry, missing card/address, and disabled-product checks are
 * authoritative; stock is best-effort (skipped while Manual). Sets status=issue
 * (+ Delivery Issue alert) or restores to pending when an issue clears.
 */
export async function runPreRunCheck(now: Date = new Date()): Promise<{ checked: number; issues: number }> {
  const today = etToday(now);
  const horizon = addDays(today, 2);
  const { data: runs } = await supabaseAdmin
    .from('subscription_delivery_runs')
    .select('*')
    .in('status', ['pending', 'issue'])
    .gte('cycle_date', today)
    .lte('cycle_date', horizon);

  let checked = 0;
  let issues = 0;
  for (const run of (runs as RunRow[]) || []) {
    checked += 1;
    const issue = await evaluateRunIssue(run);
    if (issue) {
      issues += 1;
      await supabaseAdmin
        .from('subscription_delivery_runs')
        .update({ status: 'issue', issue_details: issue })
        .eq('id', run.id);
      await createDeliveryIssueAlert({
        userId: run.user_id,
        deliveryId: run.delivery_id,
        weekNumber: run.week_number,
        runId: run.id,
        cycleDate: run.cycle_date,
        issueType: issue.issue_type as string,
        adminNote: issue.message as string,
        cardLast4: (issue.card_last4 as string) ?? null,
      });
    } else if (run.status === 'issue') {
      // Issue cleared before processing -> back to pending.
      await supabaseAdmin
        .from('subscription_delivery_runs')
        .update({ status: 'pending', issue_details: null })
        .eq('id', run.id);
    }
  }
  return { checked, issues };
}

/** Returns an issue descriptor if the run can't process cleanly, else null. */
async function evaluateRunIssue(run: RunRow): Promise<Record<string, unknown> | null> {
  const subscription = await getSubscriptionByUser(run.user_id);
  if (!subscription) return { issue_type: ISSUE.OTHER, message: 'Subscription not found' };

  if (!subscription.payment_method_id) {
    return { issue_type: ISSUE.NO_PAYMENT_METHOD, message: 'No subscription card on file' };
  }
  if (!subscription.subscription_address_id) {
    return { issue_type: ISSUE.NO_ADDRESS, message: 'No subscription address on file' };
  }

  const { data: card } = await supabaseAdmin
    .from('payment_methods')
    .select('card_exp_month, card_exp_year, card_last4')
    .eq('id', subscription.payment_method_id)
    .maybeSingle();
  if (isCardExpired(card)) {
    return { issue_type: ISSUE.EXPIRED_CARD, message: 'Subscription card has expired', card_last4: card?.card_last4 };
  }

  const items = await getDeliveryItems(run.delivery_id);
  if (items.length === 0) {
    return { issue_type: ISSUE.PRODUCTS_UNAVAILABLE, message: 'Delivery package is empty' };
  }
  const enabled = items.filter((i) => i.catalog_products?.status === 'active');
  if (enabled.length === 0) {
    return { issue_type: ISSUE.PRODUCTS_UNAVAILABLE, message: 'All products in the package are disabled' };
  }
  return null;
}

// ============================================================
// Lock / snapshot (midnight ET on the processing date)
// ============================================================

/**
 * Lock all pending/issue runs whose cycle_date is today (ET). Snapshots the
 * package; hard issues (no/expired card, no address, nothing shippable) are
 * marked failed without an attempt; otherwise the run is locked for the worker.
 */
export async function lockCycle(now: Date = new Date()): Promise<{ locked: number; failed: number }> {
  const today = etToday(now);
  const { data: runs } = await supabaseAdmin
    .from('subscription_delivery_runs')
    .select('*')
    .in('status', ['pending', 'issue'])
    .eq('cycle_date', today);

  let locked = 0;
  let failed = 0;
  for (const run of (runs as RunRow[]) || []) {
    const result = await lockSingleRun(run, now);
    if (result === 'locked') locked += 1;
    else if (result === 'failed') failed += 1;
  }
  return { locked, failed };
}

async function lockSingleRun(run: RunRow, now: Date): Promise<'locked' | 'failed' | 'skip'> {
  const subscription = await getSubscriptionByUser(run.user_id);
  if (!subscription) return 'skip';

  // Hard pre-conditions: fail without attempting.
  let hardIssue: { issue_type: string; message: string; card_last4?: string | null } | null = null;
  if (!subscription.payment_method_id) {
    hardIssue = { issue_type: ISSUE.NO_PAYMENT_METHOD, message: 'No subscription card on file' };
  } else if (!subscription.subscription_address_id) {
    hardIssue = { issue_type: ISSUE.NO_ADDRESS, message: 'No subscription address on file' };
  } else {
    const { data: card } = await supabaseAdmin
      .from('payment_methods')
      .select('card_exp_month, card_exp_year, card_last4')
      .eq('id', subscription.payment_method_id)
      .maybeSingle();
    if (isCardExpired(card)) {
      hardIssue = { issue_type: ISSUE.EXPIRED_CARD, message: 'Subscription card has expired', card_last4: card?.card_last4 };
    }
  }

  const isWhitelisted = await loadUserWhitelist(run.user_id);
  const snap = hardIssue ? { includedSubtotal: 0, includedCount: 0, skippedCount: 0 } : await snapshotPackage(run, isWhitelisted);

  if (!hardIssue && snap.includedCount === 0) {
    hardIssue = { issue_type: ISSUE.PRODUCTS_UNAVAILABLE, message: 'No shippable products in the package' };
  }

  if (hardIssue) {
    await supabaseAdmin
      .from('subscription_delivery_runs')
      .update({
        status: 'failed',
        failure_details: { ...hardIssue, stage: 'lock', attempted: false, prior_issue: run.status === 'issue' },
        processed_at: new Date().toISOString(),
      })
      .eq('id', run.id);
    await createFailedDeliveryAlert({
      userId: run.user_id,
      deliveryId: run.delivery_id,
      weekNumber: run.week_number,
      runId: run.id,
      cycleDate: run.cycle_date,
      issueType: hardIssue.issue_type,
      cardLast4: hardIssue.card_last4 ?? null,
    });
    await logSubscriptionEvent({
      subscriptionId: run.subscription_id,
      deliveryId: run.delivery_id,
      runId: run.id,
      eventType: 'run_failed_at_lock',
      details: hardIssue,
    });
    return 'failed';
  }

  await supabaseAdmin
    .from('subscription_delivery_runs')
    .update({ status: 'locked', locked_at: new Date().toISOString(), subtotal_cents: snap.includedSubtotal })
    .eq('id', run.id);
  await logSubscriptionEvent({
    subscriptionId: run.subscription_id,
    deliveryId: run.delivery_id,
    runId: run.id,
    eventType: 'run_locked',
    details: { included: snap.includedCount, skipped: snap.skippedCount, subtotal_cents: snap.includedSubtotal },
  });
  return 'locked';
}

// ============================================================
// Process a single run (charge + create manual order)
// ============================================================

export async function processRun(runId: string, actor: 'system' | 'admin' | 'hotline' = 'system'): Promise<{ status: string }> {
  // Claim atomically: only one worker may move locked -> processing.
  const { data: claimed } = await supabaseAdmin
    .from('subscription_delivery_runs')
    .update({ status: 'processing' })
    .eq('id', runId)
    .in('status', ['locked'])
    .select('*')
    .maybeSingle();
  if (!claimed) {
    // Allow explicit retries of failed runs to re-enter here.
    const { data: retry } = await supabaseAdmin
      .from('subscription_delivery_runs')
      .update({ status: 'processing' })
      .eq('id', runId)
      .in('status', ['failed', 'issue'])
      .select('*')
      .maybeSingle();
    if (!retry) return { status: 'skipped_claim' };
    return finishProcessRun(retry as RunRow, actor, true);
  }
  return finishProcessRun(claimed as RunRow, actor, false);
}

async function finishProcessRun(run: RunRow, actor: string, isRetry: boolean): Promise<{ status: string }> {
  const attempt = (run.attempt_count || 0) + 1;
  const idempotencyKey = `${run.user_id}:${run.week_number}:${run.cycle_date}:${attempt}`;
  await supabaseAdmin
    .from('subscription_delivery_runs')
    .update({ attempt_count: attempt, idempotency_key: idempotencyKey })
    .eq('id', run.id);

  const subscription = await getSubscriptionByUser(run.user_id);
  if (!subscription || !subscription.payment_method_id || !subscription.subscription_address_id) {
    return failRun(run, { issue_type: ISSUE.OTHER, message: 'Missing card or address at processing time' }, false);
  }

  const [{ data: card }, { data: address }, { data: user }] = await Promise.all([
    supabaseAdmin.from('payment_methods').select('*').eq('id', subscription.payment_method_id).maybeSingle(),
    supabaseAdmin.from('addresses').select('*').eq('id', subscription.subscription_address_id).maybeSingle(),
    supabaseAdmin.from('users').select('name').eq('id', run.user_id).maybeSingle(),
  ]);
  if (!card || !address) {
    return failRun(run, { issue_type: ISSUE.OTHER, message: 'Card or address record missing' }, false);
  }

  // If we are re-processing (retry), re-snapshot so disabled products / new
  // prices are reflected.
  if (isRetry) {
    const isWhitelisted = await loadUserWhitelist(run.user_id);
    await snapshotPackage(run, isWhitelisted);
  }

  const { data: runItems } = await supabaseAdmin
    .from('subscription_delivery_run_items')
    .select('*')
    .eq('run_id', run.id);
  const included = (runItems || []).filter((ri: any) => ri.status === 'included' || ri.status === 'reduced');
  const skipped = (runItems || []).filter((ri: any) => ri.status !== 'included' && ri.status !== 'reduced');

  if (included.length === 0) {
    return failRun(run, { issue_type: ISSUE.PRODUCTS_UNAVAILABLE, message: 'No shippable products' }, false);
  }

  const subtotal = included.reduce((s: number, ri: any) => s + ri.unit_price_cents * ri.quantity, 0);
  const pricing = await calculateManualPricing(subtotal, address.state);
  const total = pricing.totalCents;

  // --- Charge the stored card (merchant-initiated, recurring) ---
  let sale;
  try {
    sale = await solaSaleRecurring(card.sola_token, total, {
      invoice: idempotencyKey,
      name: user?.name || undefined,
      description: `VoiceX subscription Week ${run.week_number} ${run.cycle_date}`,
    });
  } catch (err) {
    return failRun(run, { issue_type: ISSUE.DECLINED_CARD, message: `Charge error: ${String(err)}`, card_last4: card.card_last4 }, false);
  }
  if (sale.xResult !== 'A') {
    return failRun(
      run,
      { issue_type: ISSUE.DECLINED_CARD, message: sale.xError || 'Card declined', x_result: sale.xResult, x_error_code: sale.xErrorCode, card_last4: card.card_last4 },
      false,
    );
  }

  // --- Create the manual order ---
  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .insert({
      user_id: run.user_id,
      cart_id: null,
      address_id: address.id,
      payment_method_id: card.id,
      fulfillment_provider: 'manual',
      fulfillment_status: 'queued',
      status: 'completed',
      subtotal_cents: subtotal,
      shipping_cents: pricing.shippingCents,
      tax_cents: pricing.taxCents,
      total_cents: total,
      card_brand_snapshot: card.card_brand ?? null,
      card_last4_snapshot: card.card_last4 ?? null,
      subscription_delivery_run_id: run.id,
      subscription_week_number: run.week_number,
    })
    .select('id')
    .single();

  if (orderErr || !order) {
    // Charged but order failed to persist -> needs manual review, but the run
    // is recorded as processed with the charge ref so money is traceable.
    await supabaseAdmin
      .from('subscription_delivery_runs')
      .update({
        status: 'failed',
        sola_ref_num: sale.xRefNum,
        failure_details: { issue_type: ISSUE.OTHER, message: `Order persist failed after charge: ${orderErr?.message}`, sola_ref_num: sale.xRefNum, manual_review: true },
        processed_at: new Date().toISOString(),
      })
      .eq('id', run.id);
    return { status: 'failed' };
  }

  const orderId = String(order.id);
  const orderItems = included.map((ri: any) => ({
    order_id: orderId,
    product_id: ri.product_id,
    voicex_id: ri.voicex_id,
    product_name: ri.product_name,
    quantity: ri.quantity,
    unit_price_cents: ri.unit_price_cents,
    amazon_price_cents: ri.amazon_price_cents,
  }));
  await supabaseAdmin.from('order_items').insert(orderItems);
  await supabaseAdmin.from('order_events').insert({
    order_id: orderId,
    status: 'completed',
    source: 'system',
    details: { action: 'subscription_order_created', week: run.week_number, cycle_date: run.cycle_date, sola_ref_num: sale.xRefNum },
  });
  for (const ri of included) {
    await supabaseAdmin.rpc('increment_product_sold', { p_product_id: ri.product_id, p_qty: ri.quantity });
  }

  const finalStatus = skipped.length > 0 ? 'partial' : 'processed';
  await supabaseAdmin
    .from('subscription_delivery_runs')
    .update({
      status: finalStatus,
      order_id: orderId,
      sola_ref_num: sale.xRefNum,
      sola_transaction_id: sale.xRefNum,
      subtotal_cents: subtotal,
      total_cents: total,
      processed_at: new Date().toISOString(),
      failure_details: null,
    })
    .eq('id', run.id);

  await logSubscriptionEvent({
    subscriptionId: run.subscription_id,
    deliveryId: run.delivery_id,
    runId: run.id,
    eventType: finalStatus === 'partial' ? 'run_partial' : 'run_processed',
    actorType: actor as any,
    details: { order_id: orderId, total_cents: total, included: included.length, skipped: skipped.length, sola_ref_num: sale.xRefNum, attempt },
  });

  // Queue the next cycle for this delivery (advances the queue per spec).
  await scheduleNextCycle(run);

  return { status: finalStatus };
}

async function failRun(run: RunRow, failure: Record<string, unknown>, attempted: boolean): Promise<{ status: string }> {
  await supabaseAdmin
    .from('subscription_delivery_runs')
    .update({ status: 'failed', failure_details: { ...failure, attempted }, processed_at: new Date().toISOString() })
    .eq('id', run.id);
  await createFailedDeliveryAlert({
    userId: run.user_id,
    deliveryId: run.delivery_id,
    weekNumber: run.week_number,
    runId: run.id,
    cycleDate: run.cycle_date,
    issueType: (failure.issue_type as string) || ISSUE.OTHER,
    cardLast4: (failure.card_last4 as string) ?? null,
  });
  await logSubscriptionEvent({
    subscriptionId: run.subscription_id,
    deliveryId: run.delivery_id,
    runId: run.id,
    eventType: 'run_failed',
    details: failure,
  });
  return { status: 'failed' };
}

/** After a run resolves, ensure the delivery has a pending run for next month. */
async function scheduleNextCycle(run: RunRow): Promise<void> {
  const delivery = await getDelivery(run.delivery_id);
  const subscription = await getSubscriptionByUser(run.user_id);
  if (!delivery || !subscription) return;
  if (delivery.status !== 'active') return;
  await ensureUpcomingRun(delivery, subscription as SubscriptionRow);
  await recomputeNextCycleDate(delivery as DeliveryRow);
}

// ============================================================
// Worker: drain locked runs with spacing
// ============================================================

export async function drainDueRuns(maxRuns = 500): Promise<{ processed: number }> {
  let processed = 0;
  for (let i = 0; i < maxRuns; i += 1) {
    const { data: next } = await supabaseAdmin
      .from('subscription_delivery_runs')
      .select('id')
      .eq('status', 'locked')
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!next) break;
    await processRun(next.id, 'system');
    processed += 1;
    if (config.subscriptions.processSpacingMs > 0) {
      await sleep(config.subscriptions.processSpacingMs);
    }
  }
  return { processed };
}

let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;

/** Start the in-process worker loop that drains locked runs. */
export function startSubscriptionWorker(): void {
  if (workerTimer) return;
  const tick = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await drainDueRuns();
    } catch (err) {
      console.error('[subscription-worker] drain error:', err);
    } finally {
      workerRunning = false;
    }
  };
  workerTimer = setInterval(tick, config.subscriptions.workerPollMs);
  // Kick once shortly after boot.
  setTimeout(tick, 5000);
  console.log('[subscription-worker] started');
}

// ============================================================
// Admin/IVR actions: retry & skip
// ============================================================

export async function retryRun(runId: string, actor: 'admin' | 'hotline' = 'admin', actorAdminId?: string | null): Promise<{ status: string }> {
  const { data: run } = await supabaseAdmin.from('subscription_delivery_runs').select('*').eq('id', runId).maybeSingle();
  if (!run) return { status: 'not_found' };
  await logSubscriptionEvent({
    subscriptionId: run.subscription_id,
    deliveryId: run.delivery_id,
    runId: run.id,
    eventType: 'run_retry_requested',
    actorType: actor,
    actorAdminId: actorAdminId ?? null,
  });
  return processRun(runId, actor);
}

export async function skipRun(runId: string, actor: 'admin' | 'hotline' = 'admin', actorAdminId?: string | null): Promise<{ status: string }> {
  const { data: run } = await supabaseAdmin.from('subscription_delivery_runs').select('*').eq('id', runId).maybeSingle();
  if (!run) return { status: 'not_found' };
  await supabaseAdmin
    .from('subscription_delivery_runs')
    .update({ status: 'skipped', processed_at: new Date().toISOString() })
    .eq('id', runId);
  await logSubscriptionEvent({
    subscriptionId: run.subscription_id,
    deliveryId: run.delivery_id,
    runId: run.id,
    eventType: 'run_skipped',
    actorType: actor,
    actorAdminId: actorAdminId ?? null,
  });
  await scheduleNextCycle(run as RunRow);
  return { status: 'skipped' };
}

// ============================================================
// utils
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
