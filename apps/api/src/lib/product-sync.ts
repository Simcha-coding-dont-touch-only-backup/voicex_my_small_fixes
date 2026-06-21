import {
  SETTING_KEYS,
  getProductPriceCents,
  resolveEffectiveMarkup,
  type CatalogProduct,
  type ProductSyncActorKind,
  type ProductSyncTrigger,
  type SyncJobState,
} from '@voicex/shared';
import { supabaseAdmin } from './supabase.js';
import { fetchAmazonProduct, RainforestProductLookupError } from './rainforest.js';
import { syncProductCatalogAlerts, getDefaultMarkupPercent } from './product-price-alerts.js';

export interface SyncActor {
  kind: ProductSyncActorKind;
  label: string;
  adminUserId?: string | null;
}

export interface RainforestSyncSettings {
  autoSyncEnabled: boolean;
  intervalHours: number;
  checkoutRevalidationEnabled: boolean;
}

export async function getRainforestSyncSettings(): Promise<RainforestSyncSettings> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('key, value')
    .in('key', [
      SETTING_KEYS.RAINFOREST_AUTO_SYNC_ENABLED,
      SETTING_KEYS.RAINFOREST_SYNC_INTERVAL_HOURS,
      SETTING_KEYS.RAINFOREST_CHECKOUT_REVALIDATION_ENABLED,
    ]);

  const map = new Map<string, string>();
  for (const row of data || []) map.set(row.key as string, row.value as string);

  const interval = Number(map.get(SETTING_KEYS.RAINFOREST_SYNC_INTERVAL_HOURS) ?? '24');
  return {
    autoSyncEnabled: map.get(SETTING_KEYS.RAINFOREST_AUTO_SYNC_ENABLED) === 'true',
    intervalHours: Number.isFinite(interval) && interval > 0 ? interval : 24,
    checkoutRevalidationEnabled:
      map.get(SETTING_KEYS.RAINFOREST_CHECKOUT_REVALIDATION_ENABLED) === 'true',
  };
}

/** Most recent full (auto/manual_full) sync run start time, or null if none. */
export async function getLastFullSyncStartedAt(): Promise<Date | null> {
  const { data } = await supabaseAdmin
    .from('product_sync_runs')
    .select('started_at')
    .in('trigger', ['auto', 'manual_full'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ started_at: string }>();
  if (!data?.started_at) return null;
  const t = new Date(data.started_at);
  return Number.isNaN(t.getTime()) ? null : t;
}

export const SYSTEM_ACTOR: SyncActor = { kind: 'system', label: 'System' };
export const CHECKOUT_ACTOR: SyncActor = { kind: 'checkout', label: 'Checkout' };

export function adminActor(admin: { id: string; name?: string | null; email?: string | null } | null | undefined): SyncActor {
  const label = admin?.name || admin?.email || 'Admin';
  return { kind: 'admin', label, adminUserId: admin?.id ?? null };
}

export interface ProductSyncResult {
  productId: string;
  asin: string | null;
  /** Whether the Amazon price changed. */
  priceChanged: boolean;
  oldAmazonCents: number | null;
  newAmazonCents: number | null;
  direction: 'up' | 'down' | null;
  availability: 'in_stock' | 'out_of_stock' | 'unknown' | null;
  isPurchasable: boolean;
  becameUnavailable: boolean;
  oldStatus: string | null;
  newStatus: string | null;
  /** True when no ASIN or lookup returned nothing actionable. */
  skipped: boolean;
  error: string | null;
}

interface ProductSyncRowForSync {
  id: string;
  amazon_asin: string | null;
  amazon_price_cents: number | null;
  status: string;
}

export async function insertPriceHistory(
  productId: string,
  oldCents: number | null,
  newCents: number | null,
  actor: SyncActor,
): Promise<void> {
  const { error } = await supabaseAdmin.from('product_history').insert({
    product_id: productId,
    change_type: 'price',
    old_value: oldCents == null ? null : String(oldCents),
    new_value: newCents == null ? null : String(newCents),
    actor_kind: actor.kind,
    actor_label: actor.label,
    actor_admin_user_id: actor.adminUserId ?? null,
  });
  if (error) console.error('[product-sync] failed to insert price history:', error.message);
}

export async function insertStatusHistory(
  productId: string,
  oldStatus: string | null,
  newStatus: string | null,
  actor: SyncActor,
): Promise<void> {
  if (oldStatus === newStatus) return;
  const { error } = await supabaseAdmin.from('product_history').insert({
    product_id: productId,
    change_type: 'status',
    old_value: oldStatus,
    new_value: newStatus,
    actor_kind: actor.kind,
    actor_label: actor.label,
    actor_admin_user_id: actor.adminUserId ?? null,
  });
  if (error) console.error('[product-sync] failed to insert status history:', error.message);
}

/**
 * Sync a single product's Amazon price/availability from Rainforest.
 * - Updates `amazon_price_cents` when it changed (custom price auto-bumps via
 *   read-time markup when no manual custom price is set).
 * - Logs a `product_history` price row on change.
 * - Re-runs `syncProductCatalogAlerts` so freeze>auto + alert behavior is
 *   identical to the rest of the app, and logs a status history row when the
 *   status flips as a result.
 */
export async function syncProductPriceFromAmazon(
  productId: string,
  actor: SyncActor,
): Promise<ProductSyncResult> {
  const base: ProductSyncResult = {
    productId,
    asin: null,
    priceChanged: false,
    oldAmazonCents: null,
    newAmazonCents: null,
    direction: null,
    availability: null,
    isPurchasable: false,
    becameUnavailable: false,
    oldStatus: null,
    newStatus: null,
    skipped: false,
    error: null,
  };

  const { data: product, error } = await supabaseAdmin
    .from('catalog_products')
    .select('id, amazon_asin, amazon_price_cents, status')
    .eq('id', productId)
    .is('deleted_at', null)
    .maybeSingle<ProductSyncRowForSync>();

  if (error || !product) {
    return { ...base, skipped: true, error: error?.message || 'Product not found' };
  }

  base.asin = product.amazon_asin;
  base.oldAmazonCents = product.amazon_price_cents;
  base.oldStatus = product.status;

  if (!product.amazon_asin) {
    return { ...base, skipped: true, error: 'Product has no ASIN' };
  }

  let lookup;
  try {
    lookup = await fetchAmazonProduct(product.amazon_asin);
  } catch (err) {
    const message =
      err instanceof RainforestProductLookupError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Rainforest lookup failed';
    return { ...base, skipped: true, error: message };
  }

  if (!lookup) {
    // ASIN not found on Amazon: treat as unavailable signal but do not wipe price.
    return { ...base, availability: 'unknown', becameUnavailable: false, error: 'ASIN not found on Amazon' };
  }

  base.availability = lookup.availability;
  base.isPurchasable = lookup.is_purchasable;
  base.becameUnavailable = lookup.availability === 'out_of_stock';
  base.newAmazonCents = lookup.price_cents;

  const newCents = lookup.price_cents;
  // A price change includes the transition to/from null: a product that loses
  // its Amazon buybox price (newCents === null) is going unavailable, which is
  // an auditable state change that must be logged just like a numeric change.
  if (newCents !== product.amazon_price_cents) {
    const { error: updErr } = await supabaseAdmin
      .from('catalog_products')
      .update({ amazon_price_cents: newCents, updated_at: new Date().toISOString() })
      .eq('id', productId);
    if (updErr) {
      return { ...base, error: updErr.message };
    }
    base.priceChanged = true;
    base.direction =
      newCents == null
        ? 'down'
        : product.amazon_price_cents == null
          ? 'up'
          : newCents > product.amazon_price_cents
            ? 'up'
            : 'down';
    await insertPriceHistory(productId, product.amazon_price_cents, newCents, actor);

    // Re-evaluate alerts + auto-freeze using existing logic. Any resulting
    // status flip is logged to product_history by applyAutoFreezeState itself
    // (system actor), so we only read the resulting status here.
    await syncProductCatalogAlerts(productId);

    const { data: after } = await supabaseAdmin
      .from('catalog_products')
      .select('status')
      .eq('id', productId)
      .maybeSingle<{ status: string }>();
    base.newStatus = after?.status ?? product.status;
  } else {
    base.newStatus = product.status;
  }

  return base;
}

// ---------------------------------------------------------------------------
// Sync runs (report history)
// ---------------------------------------------------------------------------

export interface CreateSyncRunArgs {
  trigger: ProductSyncTrigger;
  actor: SyncActor;
  total?: number;
  orderId?: number | null;
  userId?: string | null;
  callerPhone?: string | null;
}

export async function createSyncRun(args: CreateSyncRunArgs): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('product_sync_runs')
    .insert({
      trigger: args.trigger,
      status: 'running',
      actor_kind: args.actor.kind,
      actor_label: args.actor.label,
      actor_admin_user_id: args.actor.adminUserId ?? null,
      total_count: args.total ?? 0,
      processed_count: 0,
      changed_count: 0,
      order_id: args.orderId ?? null,
      user_id: args.userId ?? null,
      caller_phone: args.callerPhone ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[product-sync] failed to create sync run:', error?.message);
    return null;
  }
  return data.id as string;
}

export async function addSyncRunItem(runId: string, result: ProductSyncResult): Promise<void> {
  if (!result.priceChanged && !result.becameUnavailable) return;
  const { error } = await supabaseAdmin.from('product_sync_run_items').insert({
    run_id: runId,
    product_id: result.productId,
    old_amazon_price_cents: result.oldAmazonCents,
    new_amazon_price_cents: result.newAmazonCents,
    direction: result.priceChanged ? result.direction : null,
    became_unavailable: result.becameUnavailable,
  });
  if (error) console.error('[product-sync] failed to add sync run item:', error.message);
}

/** Persist live progress so partial runs survive crashes/restarts. */
export async function updateSyncRunProgress(
  runId: string,
  processed: number,
  changed: number,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('product_sync_runs')
    .update({ processed_count: processed, changed_count: changed })
    .eq('id', runId);
  if (error) console.error('[product-sync] failed to update sync run progress:', error.message);
}

export async function finalizeSyncRun(
  runId: string,
  totals: { total: number; processed: number; changed: number; status?: 'completed' | 'paused' | 'failed' },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('product_sync_runs')
    .update({
      status: totals.status ?? 'completed',
      total_count: totals.total,
      processed_count: totals.processed,
      changed_count: totals.changed,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);
  if (error) console.error('[product-sync] failed to finalize sync run:', error.message);
}

export async function backfillSyncRunOrder(runId: string, orderId: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('product_sync_runs')
    .update({ order_id: orderId })
    .eq('id', runId);
  if (error) console.error('[product-sync] failed to backfill sync run order:', error.message);
}

/**
 * Finalize every full/auto/bulk-sync row left in a non-terminal state
 * (`running` or `paused`) as `failed`. In-memory job state tracks only a single
 * run, so a process restart while a row is still `running`/`paused` strands
 * that row forever. This DB-level sweep reconciles all such orphans, regardless
 * of how many accumulated. Pass `exceptRunId` to skip a row that is still
 * actively owned by the current in-memory job.
 */
export async function reconcileOrphanedSyncRuns(exceptRunId?: string | null): Promise<void> {
  let query = supabaseAdmin
    .from('product_sync_runs')
    .select('id, processed_count, changed_count')
    .in('trigger', ['auto', 'manual_full', 'manual_bulk'])
    .in('status', ['running', 'paused']);
  if (exceptRunId) query = query.neq('id', exceptRunId);
  const { data: orphans, error: fetchErr } = await query;
  if (fetchErr) {
    console.error('[product-sync] failed to list orphaned sync runs:', fetchErr.message);
    return;
  }
  for (const orphan of orphans || []) {
    const { count: itemCount, error: countErr } = await supabaseAdmin
      .from('product_sync_run_items')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', orphan.id);
    if (countErr) {
      console.error('[product-sync] failed to count sync run items:', countErr.message);
      continue;
    }
    const changed = Math.max(orphan.changed_count ?? 0, itemCount ?? 0);
    const { error } = await supabaseAdmin
      .from('product_sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        changed_count: changed,
        // Keep processed_count when incremental progress was persisted; otherwise
        // leave it (report UI falls back to item count as a lower bound).
      })
      .eq('id', orphan.id);
    if (error) console.error('[product-sync] failed to reconcile orphaned sync run:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Full sync job (in-memory, server-side, survives client navigation)
// ---------------------------------------------------------------------------

const SYNC_SPACING_MS = 1500;

const jobState: SyncJobState = {
  status: 'idle',
  total: 0,
  processed: 0,
  changed: 0,
  currentProductId: null,
  currentProductName: null,
  startedAt: null,
  runId: null,
  pauseRequested: false,
  lastError: null,
};

export function getSyncJobState(): SyncJobState {
  return { ...jobState };
}

export function requestSyncPause(): void {
  if (jobState.status === 'running') {
    jobState.pauseRequested = true;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true if the product was updated (manually/checkout/auto) within the last `hours`. */
function updatedWithinHours(updatedAt: string | null | undefined, hours: number): boolean {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < hours * 60 * 60 * 1000;
}

/**
 * Load active products eligible for a full/auto sync, skipping any updated in
 * the last 12 hours (to save Rainforest credits).
 */
async function loadActiveProductsForSync(): Promise<{ id: string; voice_name: string | null; amazon_name: string | null; updated_at: string }[]> {
  const out: { id: string; voice_name: string | null; amazon_name: string | null; updated_at: string }[] = [];
  const pageSize = 500;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('catalog_products')
      .select('id, voice_name, amazon_name, updated_at')
      .eq('status', 'active')
      .is('deleted_at', null)
      .not('amazon_asin', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error('[product-sync] failed to load active products:', error.message);
      break;
    }
    if (!data?.length) break;
    for (const row of data) out.push(row as any);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

export interface RunFullSyncOptions {
  trigger: Extract<ProductSyncTrigger, 'auto' | 'manual_full'>;
  actor: SyncActor;
  skipRecentlyUpdated?: boolean;
}

/**
 * Runs a full sync over all active products. Used by both the manual "Sync Now"
 * job and the scheduled cron. Updates the in-memory job state and persists a
 * `product_sync_runs` row. Honors the in-memory pause flag between products.
 */
export async function runFullSync(opts: RunFullSyncOptions): Promise<{ runId: string | null; processed: number; changed: number; paused: boolean }> {
  // A 'running' job owns the in-memory state and is actively iterating, so a new
  // sync must not start. A 'paused' job is restartable ("Sync Now" begins a
  // fresh run); its stale `product_sync_runs` row is finalized by the
  // reconciliation sweep below before a fresh run starts.
  if (jobState.status === 'running') {
    return { runId: jobState.runId, processed: jobState.processed, changed: jobState.changed, paused: false };
  }

  // Claim the slot synchronously (before any await) so two concurrent callers
  // can't both pass the guard above during the async setup below.
  jobState.status = 'running';
  jobState.pauseRequested = false;
  jobState.lastError = null;

  // A previous job (this process or an earlier one that has since restarted)
  // may have left a `product_sync_runs` row stuck in 'running'/'paused'. We
  // don't resume in place, so finalize every such orphan as 'failed' before
  // starting fresh. This sweeps all stranded rows at the DB level rather than
  // only the single run tracked by in-memory state, which is lost on restart.
  await reconcileOrphanedSyncRuns();

  const allProducts = await loadActiveProductsForSync();
  const products = opts.skipRecentlyUpdated
    ? allProducts.filter((p) => !updatedWithinHours(p.updated_at, 12))
    : allProducts;

  const runId = await createSyncRun({ trigger: opts.trigger, actor: opts.actor, total: products.length });

  jobState.total = products.length;
  jobState.processed = 0;
  jobState.changed = 0;
  jobState.currentProductId = null;
  jobState.currentProductName = null;
  jobState.startedAt = new Date().toISOString();
  jobState.runId = runId;
  jobState.pauseRequested = false;
  jobState.lastError = null;

  let paused = false;
  try {
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      jobState.currentProductId = p.id;
      jobState.currentProductName = p.voice_name || p.amazon_name || null;

      const result = await syncProductPriceFromAmazon(p.id, opts.actor);
      if (runId) await addSyncRunItem(runId, result);
      if (result.priceChanged || result.becameUnavailable) jobState.changed += 1;
      if (result.error) jobState.lastError = result.error;
      jobState.processed += 1;
      if (runId) await updateSyncRunProgress(runId, jobState.processed, jobState.changed);

      if (jobState.pauseRequested) {
        paused = true;
        break;
      }
      if (i < products.length - 1) await delay(SYNC_SPACING_MS);
    }
  } catch (err) {
    jobState.lastError = err instanceof Error ? err.message : String(err);
  }

  if (runId) {
    await finalizeSyncRun(runId, {
      total: jobState.total,
      processed: jobState.processed,
      changed: jobState.changed,
      status: paused ? 'paused' : 'completed',
    });
  }

  const processed = jobState.processed;
  const changed = jobState.changed;

  // Only stay 'paused' when there's a backing run row to resume/finalize. If
  // `createSyncRun` failed (runId === null), a pause has nothing to persist, so
  // settle to 'idle' instead of stranding the in-memory state at 'paused'.
  const persistedPause = paused && runId !== null;
  jobState.status = persistedPause ? 'paused' : 'idle';
  jobState.currentProductId = null;
  jobState.currentProductName = null;
  jobState.pauseRequested = false;
  if (!persistedPause) {
    jobState.runId = null;
  }

  return { runId, processed, changed, paused };
}

export interface RunBulkSyncOptions {
  /** Specific product ids to sync (the admin's selection). */
  ids: string[];
  actor: SyncActor;
}

/**
 * Runs a manual bulk sync over a specific set of selected product ids. Shares
 * the same in-memory `jobState` and `product_sync_runs` row machinery as
 * `runFullSync`, so the admin UI can poll `/sync/status` for live progress and
 * the HTTP request that triggers it returns immediately (avoiding gateway
 * timeouts on large selections). Honors the in-memory pause flag between
 * products.
 */
export async function runBulkSync(opts: RunBulkSyncOptions): Promise<{ runId: string | null; processed: number; changed: number; paused: boolean }> {
  // Same single-slot guard as runFullSync: a running job owns jobState.
  if (jobState.status === 'running') {
    return { runId: jobState.runId, processed: jobState.processed, changed: jobState.changed, paused: false };
  }

  // Claim the slot synchronously before any await.
  jobState.status = 'running';
  jobState.pauseRequested = false;
  jobState.lastError = null;

  // Finalize any orphaned full/auto runs stranded by a prior process.
  await reconcileOrphanedSyncRuns();

  const ids = opts.ids;
  const runId = await createSyncRun({ trigger: 'manual_bulk', actor: opts.actor, total: ids.length });

  jobState.total = ids.length;
  jobState.processed = 0;
  jobState.changed = 0;
  jobState.currentProductId = null;
  jobState.currentProductName = null;
  jobState.startedAt = new Date().toISOString();
  jobState.runId = runId;
  jobState.pauseRequested = false;
  jobState.lastError = null;

  let paused = false;
  try {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      jobState.currentProductId = id;
      jobState.currentProductName = null;

      const result = await syncProductPriceFromAmazon(id, opts.actor);
      if (runId) await addSyncRunItem(runId, result);
      if (result.priceChanged || result.becameUnavailable) jobState.changed += 1;
      if (result.error) jobState.lastError = result.error;
      jobState.processed += 1;
      if (runId) await updateSyncRunProgress(runId, jobState.processed, jobState.changed);

      if (jobState.pauseRequested) {
        paused = true;
        break;
      }
      if (i < ids.length - 1) await delay(SYNC_SPACING_MS);
    }
  } catch (err) {
    jobState.lastError = err instanceof Error ? err.message : String(err);
  }

  if (runId) {
    await finalizeSyncRun(runId, {
      total: jobState.total,
      processed: jobState.processed,
      changed: jobState.changed,
      status: paused ? 'paused' : 'completed',
    });
  }

  const processed = jobState.processed;
  const changed = jobState.changed;

  // Bulk runs are not resumable (the selection isn't persisted), so settle to
  // 'idle' even when paused; the run row is finalized as 'paused' above.
  jobState.status = 'idle';
  jobState.currentProductId = null;
  jobState.currentProductName = null;
  jobState.pauseRequested = false;
  jobState.runId = null;

  return { runId, processed, changed, paused };
}

// ---------------------------------------------------------------------------
// Checkout revalidation (manual fulfillment path)
// ---------------------------------------------------------------------------

export interface CheckoutCartItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  voicex_id: string | null;
  /** Joined catalog product row (selected as catalog_products(*)). */
  catalog_products: any;
}

export interface CheckoutRevalidationItemChange {
  cartItemId: string;
  productId: string;
  productName: string;
  oldUnitPriceCents: number;
  newUnitPriceCents: number;
  direction: 'up' | 'down';
}

export interface CheckoutRevalidationUnavailable {
  cartItemId: string;
  productId: string;
  productName: string;
}

export interface CheckoutRevalidationResult {
  hasChanges: boolean;
  priceChanges: CheckoutRevalidationItemChange[];
  unavailable: CheckoutRevalidationUnavailable[];
  /** Remaining items after removing unavailable ones, with refreshed unit prices. */
  remainingItems: CheckoutCartItem[];
  runId: string | null;
}

/**
 * Re-checks each cart item against Rainforest at checkout (manual path).
 * Updates catalog Amazon prices (logging history + alerts via
 * `syncProductPriceFromAmazon`), refreshes the cart item unit prices, removes
 * items that are no longer available, and records a `checkout`-trigger sync run
 * when anything changed (so it shows in the Product Sync report).
 */
export async function revalidateCartAtCheckout(
  cartItems: CheckoutCartItem[],
  context: {
    userId: string | null;
    callerPhone: string | null;
    isWhitelisted: boolean;
    customMarkupPercent?: number | null;
  },
): Promise<CheckoutRevalidationResult> {
  const defaultMarkupPercent = await getDefaultMarkupPercent();
  const markupPercent = resolveEffectiveMarkup(defaultMarkupPercent, {
    custom_markup_percent: context.customMarkupPercent ?? null,
  });
  const priceChanges: CheckoutRevalidationItemChange[] = [];
  const unavailable: CheckoutRevalidationUnavailable[] = [];
  const remainingItems: CheckoutCartItem[] = [];
  const results: ProductSyncResult[] = [];

  for (const item of cartItems) {
    const productName =
      item.catalog_products?.voice_name || item.catalog_products?.amazon_name || item.voicex_id || 'a product';

    const result = await syncProductPriceFromAmazon(item.product_id, CHECKOUT_ACTOR);
    results.push(result);

    if (result.becameUnavailable) {
      unavailable.push({ cartItemId: item.id, productId: item.product_id, productName });
      await supabaseAdmin.from('cart_items').delete().eq('id', item.id);
      continue;
    }

    // Recompute the effective unit price from the refreshed catalog row.
    const { data: refreshed } = await supabaseAdmin
      .from('catalog_products')
      .select('*')
      .eq('id', item.product_id)
      .maybeSingle();

    let newUnitPrice = item.unit_price_cents;
    if (refreshed) {
      const computed = getProductPriceCents(refreshed as CatalogProduct, markupPercent, context.isWhitelisted);
      if (computed != null) newUnitPrice = computed;
    }

    if (newUnitPrice !== item.unit_price_cents) {
      await supabaseAdmin
        .from('cart_items')
        .update({
          unit_price_cents: newUnitPrice,
          amazon_price_cents: refreshed?.amazon_price_cents ?? item.catalog_products?.amazon_price_cents ?? 0,
        })
        .eq('id', item.id);

      priceChanges.push({
        cartItemId: item.id,
        productId: item.product_id,
        productName,
        oldUnitPriceCents: item.unit_price_cents,
        newUnitPriceCents: newUnitPrice,
        direction: newUnitPrice > item.unit_price_cents ? 'up' : 'down',
      });
    }

    remainingItems.push({ ...item, unit_price_cents: newUnitPrice });
  }

  const hasChanges = priceChanges.length > 0 || unavailable.length > 0;

  let runId: string | null = null;
  if (hasChanges) {
    runId = await createSyncRun({
      trigger: 'checkout',
      actor: CHECKOUT_ACTOR,
      total: cartItems.length,
      userId: context.userId,
      callerPhone: context.callerPhone,
    });
    if (runId) {
      for (const result of results) {
        await addSyncRunItem(runId, result);
      }
      await finalizeSyncRun(runId, {
        total: cartItems.length,
        processed: cartItems.length,
        changed: priceChanges.length + unavailable.length,
      });
    }
  }

  return { hasChanges, priceChanges, unavailable, remainingItems, runId };
}
