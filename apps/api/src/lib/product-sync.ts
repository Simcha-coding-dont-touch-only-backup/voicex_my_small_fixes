import {
  SETTING_KEYS,
  getProductPriceCents,
  resolveEffectiveMarkup,
  type CatalogProduct,
  type ProductSyncActorKind,
  type ProductSyncTrigger,
  type SyncJobState,
} from '@voicex/shared';
import { config } from '../config.js';
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
  /**
   * True when the live Rainforest lookup could not be completed (timeout or
   * transport/auth/rate-limit failure) and the caller is proceeding on the
   * cached catalog price instead. Used by checkout revalidation so the call is
   * never dropped, while the sync report still flags that fresh pricing was not
   * verified for this item.
   */
  stale: boolean;
  /** Reason the lookup was treated as stale (timeout, http error, etc.). */
  staleReason: string | null;
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
    stale: false,
    staleReason: null,
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
    // Could not verify fresh pricing. The cached catalog price stands; flag the
    // result as stale so checkout can proceed without dropping the call and the
    // sync report can surface that this item was not freshly verified.
    return { ...base, skipped: true, stale: true, staleReason: message, error: message };
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
  /** Persisted work queue for resumable (drained) scheduled runs. */
  pendingProductIds?: string[];
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
      pending_product_ids: args.pendingProductIds ?? [],
      last_progress_at: new Date().toISOString(),
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
  // Record an item row when something changed OR when the price could not be
  // verified (stale). Stale rows make unverified-pricing checkouts auditable.
  if (!result.priceChanged && !result.becameUnavailable && !result.stale) return;
  const { error } = await supabaseAdmin.from('product_sync_run_items').insert({
    run_id: runId,
    product_id: result.productId,
    old_amazon_price_cents: result.oldAmazonCents,
    new_amazon_price_cents: result.newAmazonCents,
    direction: result.priceChanged ? result.direction : null,
    became_unavailable: result.becameUnavailable,
    stale: result.stale,
    stale_reason: result.stale ? result.staleReason : null,
  });
  if (error) console.error('[product-sync] failed to add sync run item:', error.message);
}

/** Persist live progress so partial runs survive crashes/restarts. */
export async function updateSyncRunProgress(
  runId: string,
  processed: number,
  changed: number,
  pendingProductIds?: string[],
): Promise<void> {
  const update: Record<string, unknown> = {
    processed_count: processed,
    changed_count: changed,
    last_progress_at: new Date().toISOString(),
  };
  if (pendingProductIds) update.pending_product_ids = pendingProductIds;
  const { error } = await supabaseAdmin
    .from('product_sync_runs')
    .update(update)
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
      // Clear the work queue on terminal states to keep report payloads small;
      // a finalized run is never resumed.
      pending_product_ids: [],
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
        pending_product_ids: [],
        // Keep processed_count when incremental progress was persisted; otherwise
        // leave it (report UI falls back to item count as a lower bound).
      })
      .eq('id', orphan.id);
    if (error) console.error('[product-sync] failed to reconcile orphaned sync run:', error.message);
  }
}

/**
 * Fail out scheduled (`auto`/`manual_full`) runs whose heartbeat
 * (`last_progress_at`) has gone stale — i.e. the serverless function that owned
 * the batch was killed mid-run and no drain has touched it since. Unlike
 * `reconcileOrphanedSyncRuns` (which only runs when a *new* full sync starts),
 * this is safe to call on every frequent drain tick so a dead run is marked
 * 'failed' (red in the report) promptly, and the interval gate stops treating
 * it as an in-progress run. Returns the number of runs reconciled.
 */
export async function reconcileStaleScheduledRuns(staleMinutes = config.priceSync.staleRunMinutes): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
  // Fetch all in-progress scheduled runs, then filter for staleness in JS to
  // avoid embedding a raw timestamp inside a PostgREST `.or()` filter string.
  const { data: candidates, error: fetchErr } = await supabaseAdmin
    .from('product_sync_runs')
    .select('id, changed_count, last_progress_at')
    .eq('status', 'running')
    .in('trigger', ['auto', 'manual_full']);
  if (fetchErr) {
    console.error('[product-sync] failed to list stale scheduled runs:', fetchErr.message);
    return 0;
  }
  // Treat both an old heartbeat and a missing heartbeat (legacy rows) as stale.
  const stale = (candidates || []).filter(
    (r) => !r.last_progress_at || r.last_progress_at < cutoff,
  );
  let reconciled = 0;
  for (const run of stale) {
    const { count: itemCount } = await supabaseAdmin
      .from('product_sync_run_items')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', run.id);
    const changed = Math.max(run.changed_count ?? 0, itemCount ?? 0);
    const { error } = await supabaseAdmin
      .from('product_sync_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), changed_count: changed, pending_product_ids: [] })
      .eq('id', run.id)
      .eq('status', 'running');
    if (error) {
      console.error('[product-sync] failed to reconcile stale scheduled run:', error.message);
      continue;
    }
    reconciled += 1;
  }
  return reconciled;
}

// ---------------------------------------------------------------------------
// Full sync job (in-memory, server-side, survives client navigation)
// ---------------------------------------------------------------------------

const SYNC_SPACING_MS = config.priceSync.spacingMs;

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

/**
 * DB-aware sync status for the admin polling UI. Durable scheduled runs are
 * drained by short, separate serverless invocations, so between drain ticks the
 * in-memory `jobState` of any single process is idle even though the run is
 * still in progress. When this process isn't actively iterating, reflect the
 * active scheduled run from the DB so the "Syncing..." status bar stays live
 * across ticks and instances.
 */
export async function getSyncJobStateResolved(): Promise<SyncJobState> {
  if (jobState.status === 'running') return { ...jobState };
  const run = await getActiveScheduledRun();
  if (!run) return { ...jobState };
  const pending = Array.isArray(run.pending_product_ids) ? run.pending_product_ids.length : 0;
  return {
    status: 'running',
    total: run.total_count ?? run.processed_count + pending,
    processed: run.processed_count ?? 0,
    changed: run.changed_count ?? 0,
    currentProductId: null,
    currentProductName: null,
    startedAt: jobState.startedAt,
    runId: run.id,
    pauseRequested: false,
    lastError: null,
  };
}

export function requestSyncPause(): void {
  if (jobState.status === 'running') {
    jobState.pauseRequested = true;
  }
}

/**
 * Pause the active scheduled run. Sets the in-memory flag (so a batch currently
 * iterating in *this* process stops after the current product) and, if no
 * process is actively draining, finalizes the DB run as 'paused' immediately so
 * the drain cron stops picking it up. The remaining `pending_product_ids` are
 * preserved on the row for the record; "Sync Now" begins a fresh run.
 */
export async function pauseScheduledSync(): Promise<SyncJobState> {
  jobState.pauseRequested = true;
  if (jobState.status === 'running') {
    // A live batch in this process will observe the flag and finalize as paused.
    return { ...jobState };
  }
  const run = await getActiveScheduledRun();
  if (run) {
    await finalizeSyncRun(run.id, {
      total: run.total_count ?? run.processed_count,
      processed: run.processed_count ?? 0,
      changed: run.changed_count ?? 0,
      status: 'paused',
    });
  }
  return getSyncJobState();
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

export interface StartScheduledSyncOptions {
  trigger: Extract<ProductSyncTrigger, 'auto' | 'manual_full'>;
  actor: SyncActor;
  skipRecentlyUpdated?: boolean;
}

export type StartScheduledSyncOutcome =
  | { started: true; runId: string; total: number }
  | { started: false; reason: 'already_running' | 'nothing_to_sync' | 'create_failed'; runId?: string | null; total?: number };

/**
 * Begin a scheduled full/auto sync as a *durable, resumable* run. Instead of
 * iterating the whole catalog inside one (serverless-killable) request, this
 * computes the eligible product set, persists it as the run's
 * `pending_product_ids` queue, and returns immediately. The frequent
 * `drainScheduledSync()` cron then processes the queue a bounded batch at a
 * time until it is empty. Only one scheduled run may be in progress at a time.
 */
export async function startScheduledFullSync(opts: StartScheduledSyncOptions): Promise<StartScheduledSyncOutcome> {
  // Fail out any dead scheduled run first so a single stuck row can't block new
  // runs forever, and so a fresh start doesn't collide with a zombie.
  await reconcileStaleScheduledRuns();

  const existing = await getActiveScheduledRun();
  if (existing) {
    return { started: false, reason: 'already_running', runId: existing.id, total: existing.total_count };
  }

  const allProducts = await loadActiveProductsForSync();
  const products = opts.skipRecentlyUpdated
    ? allProducts.filter((p) => !updatedWithinHours(p.updated_at, 12))
    : allProducts;

  if (products.length === 0) {
    // Record a completed no-op run so the report shows the attempt explicitly.
    const runId = await createSyncRun({ trigger: opts.trigger, actor: opts.actor, total: 0, pendingProductIds: [] });
    if (runId) {
      await finalizeSyncRun(runId, { total: 0, processed: 0, changed: 0, status: 'completed' });
    }
    return { started: false, reason: 'nothing_to_sync', runId, total: 0 };
  }

  const ids = products.map((p) => p.id);
  const runId = await createSyncRun({
    trigger: opts.trigger,
    actor: opts.actor,
    total: ids.length,
    pendingProductIds: ids,
  });
  if (!runId) {
    return { started: false, reason: 'create_failed' };
  }
  return { started: true, runId, total: ids.length };
}

interface ActiveScheduledRun {
  id: string;
  trigger: 'auto' | 'manual_full';
  actor_kind: ProductSyncActorKind;
  actor_label: string;
  actor_admin_user_id: string | null;
  total_count: number;
  processed_count: number;
  changed_count: number;
  pending_product_ids: string[];
}

const SYNC_FIELDS =
  'id, trigger, actor_kind, actor_label, actor_admin_user_id, total_count, processed_count, changed_count, pending_product_ids';

/** The single in-progress scheduled run to resume/drain, or null. */
async function getActiveScheduledRun(): Promise<ActiveScheduledRun | null> {
  const { data } = await supabaseAdmin
    .from('product_sync_runs')
    .select(SYNC_FIELDS)
    .eq('status', 'running')
    .in('trigger', ['auto', 'manual_full'])
    .order('started_at', { ascending: true })
    .limit(1)
    .maybeSingle<ActiveScheduledRun>();
  return data ?? null;
}

/**
 * Atomically claim the active scheduled run for this drain tick using
 * `last_progress_at` as a short lease. The conditional update only succeeds if
 * the heartbeat is older than `leaseMs` (or null), so two overlapping drain
 * ticks can't both process the same run — the loser sees no claimed row. Within
 * a tick the loop bumps `last_progress_at` after every product, extending the
 * lease while work is ongoing.
 */
async function claimActiveScheduledRun(leaseMs: number): Promise<ActiveScheduledRun | null> {
  const candidate = await getActiveScheduledRun();
  if (!candidate) return null;
  // Only claim if the lease has expired (heartbeat old or missing). Read the
  // current heartbeat and decide in JS, then claim with an optimistic guard on
  // that exact value so a concurrent tick that already re-stamped it loses.
  const { data: current } = await supabaseAdmin
    .from('product_sync_runs')
    .select('last_progress_at')
    .eq('id', candidate.id)
    .maybeSingle<{ last_progress_at: string | null }>();
  const leaseCutoff = new Date(Date.now() - leaseMs).toISOString();
  const heartbeat = current?.last_progress_at ?? null;
  if (heartbeat && heartbeat >= leaseCutoff) {
    // Lease still held by another (possibly concurrent) drain tick.
    return null;
  }
  const stamp = new Date().toISOString();
  let claim = supabaseAdmin
    .from('product_sync_runs')
    .update({ last_progress_at: stamp })
    .eq('id', candidate.id)
    .eq('status', 'running');
  // Guard on the exact heartbeat we observed so only one tick wins the claim.
  claim = heartbeat === null
    ? claim.is('last_progress_at', null)
    : claim.eq('last_progress_at', heartbeat);
  const { data, error } = await claim.select(SYNC_FIELDS).maybeSingle<ActiveScheduledRun>();
  if (error) {
    console.error('[product-sync] failed to claim scheduled run:', error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Drain a bounded batch of the in-progress scheduled run's pending queue. Safe
 * to call frequently (cron) and inside a serverless function timeout: it
 * processes up to `drainBatchSize` products or until the wall-clock time budget
 * is nearly exhausted, persisting progress and the shrunken queue after each
 * product so a kill mid-batch loses at most one product's work. Finalizes the
 * run as 'completed' when the queue empties.
 */
export async function drainScheduledSync(options?: {
  maxProducts?: number;
  timeBudgetMs?: number;
}): Promise<{ runId: string | null; processed: number; changed: number; more: boolean; done: boolean }> {
  const maxProducts = options?.maxProducts ?? config.priceSync.drainBatchSize;
  const timeBudgetMs = options?.timeBudgetMs ?? config.priceSync.drainTimeBudgetMs;
  const startedAt = Date.now();

  // Reconcile dead runs before draining so we never resume a zombie.
  await reconcileStaleScheduledRuns();

  // Lease must outlast a full batch so a concurrent tick can't steal the run
  // mid-batch; the per-product heartbeat keeps extending it while we work.
  const leaseMs = timeBudgetMs + SYNC_SPACING_MS + 5000;
  const run = await claimActiveScheduledRun(leaseMs);
  if (!run) {
    return { runId: null, processed: 0, changed: 0, more: false, done: false };
  }

  const actor: SyncActor = {
    kind: run.actor_kind,
    label: run.actor_label,
    adminUserId: run.actor_admin_user_id,
  };

  const queue = Array.isArray(run.pending_product_ids) ? [...run.pending_product_ids] : [];
  let processed = run.processed_count ?? 0;
  let changed = run.changed_count ?? 0;
  let processedThisBatch = 0;
  let more = false;

  // Mirror into in-memory jobState so the admin "Sync Now" polling UI shows
  // live progress while this process owns a batch.
  jobState.status = 'running';
  jobState.runId = run.id;
  jobState.total = run.total_count ?? queue.length + processed;
  jobState.processed = processed;
  jobState.changed = changed;
  jobState.startedAt = jobState.startedAt ?? new Date().toISOString();
  jobState.lastError = null;

  let paused = false;
  for (let i = 0; i < maxProducts; i++) {
    const id = queue.shift();
    if (!id) break;

    jobState.currentProductId = id;
    jobState.currentProductName = null;

    const result = await syncProductPriceFromAmazon(id, actor);
    await addSyncRunItem(run.id, result);
    if (result.priceChanged || result.becameUnavailable) changed += 1;
    if (result.error) jobState.lastError = result.error;
    processed += 1;
    processedThisBatch += 1;

    jobState.processed = processed;
    jobState.changed = changed;

    // Persist progress + the shrunken queue after every product so a mid-batch
    // kill resumes from here (losing at most this product's redo, which is
    // idempotent anyway).
    await updateSyncRunProgress(run.id, processed, changed, queue);

    // Honor an admin pause request (in-memory; covers in-process runs and a
    // single serverless invocation). The remaining queue is persisted, so the
    // run is finalized 'paused' and "Sync Now" can begin a fresh run later.
    if (jobState.pauseRequested) {
      paused = true;
      break;
    }

    if (queue.length === 0) break;

    // Stop if the next product + spacing would risk exceeding the time budget;
    // the next drain tick continues the queue.
    if (i + 1 < maxProducts && Date.now() - startedAt + SYNC_SPACING_MS >= timeBudgetMs) {
      more = true;
      break;
    }
    if (i + 1 >= maxProducts) {
      more = true;
      break;
    }
    if (SYNC_SPACING_MS > 0) await delay(SYNC_SPACING_MS);
  }

  const done = queue.length === 0;
  if (done || paused) {
    await finalizeSyncRun(run.id, {
      total: run.total_count ?? processed,
      processed,
      changed,
      status: paused ? 'paused' : 'completed',
    });
    jobState.status = 'idle';
    jobState.currentProductId = null;
    jobState.currentProductName = null;
    jobState.pauseRequested = false;
    jobState.runId = null;
  } else {
    // Leave the run 'running' for the next drain tick. Settle in-memory state to
    // idle so this process doesn't appear to own a job between ticks.
    jobState.status = 'idle';
    jobState.currentProductId = null;
    jobState.currentProductName = null;
  }

  return { runId: run.id, processed: processedThisBatch, changed, more: more || !(done || paused), done: done || paused };
}

export interface RunFullSyncOptions {
  trigger: Extract<ProductSyncTrigger, 'auto' | 'manual_full'>;
  actor: SyncActor;
  skipRecentlyUpdated?: boolean;
}

/**
 * Legacy synchronous full sync, retained for non-serverless/in-process use
 * (e.g. local dev or scripts) where holding the call open is acceptable. The
 * scheduled (cron) and admin paths now use the durable
 * `startScheduledFullSync()` + `drainScheduledSync()` pair instead, which is
 * serverless-safe and resumable. Honors the in-memory pause flag.
 */
export async function runFullSync(opts: RunFullSyncOptions): Promise<{ runId: string | null; processed: number; changed: number; paused: boolean }> {
  if (jobState.status === 'running') {
    return { runId: jobState.runId, processed: jobState.processed, changed: jobState.changed, paused: false };
  }

  jobState.status = 'running';
  jobState.pauseRequested = false;
  jobState.lastError = null;

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

export interface CheckoutRevalidationStale {
  cartItemId: string;
  productId: string;
  productName: string;
  reason: string;
}

export interface CheckoutRevalidationResult {
  hasChanges: boolean;
  priceChanges: CheckoutRevalidationItemChange[];
  unavailable: CheckoutRevalidationUnavailable[];
  /**
   * Items whose live price could NOT be verified (Rainforest timed out or
   * errored) and which were therefore charged at the cached catalog price. The
   * checkout still proceeds; these are recorded on the sync run so the order can
   * be reviewed later.
   */
  stale: CheckoutRevalidationStale[];
  /** Remaining items after removing unavailable ones, with refreshed unit prices. */
  remainingItems: CheckoutCartItem[];
  runId: string | null;
}

export interface CheckoutRevalidationContext {
  userId: string | null;
  callerPhone: string | null;
  isWhitelisted: boolean;
  customMarkupPercent?: number | null;
}

/**
 * Run `fn` over `items` with at most `limit` promises in flight at once,
 * returning results index-aligned with `items`. Used to parallelize the slow
 * (network-bound) phase of checkout revalidation while capping concurrency so we
 * don't burst the Rainforest API into rate limits.
 *
 * Each worker claims an index in a synchronous critical section, then awaits work.
 * Under ECMAScript run-to-completion, that claim cannot interleave with other
 * workers (unlike preemptive threads); the only suspension points are `await` below.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  /** Next index to process, or `undefined` when exhausted. No `await` inside — must stay synchronous. */
  const claimIndex = (): number | undefined => {
    const i = next;
    if (i >= items.length) return undefined;
    next += 1;
    return i;
  };
  const worker = async () => {
    for (;;) {
      const index = claimIndex();
      if (index === undefined) return;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Outcome of revalidating a single cart item. The network/read phase
 * (`syncProductPriceFromAmazon` + catalog re-read) is computed first so the
 * mutation phase (cart writes, result accumulation) can run deterministically in
 * cart order.
 */
interface ItemRevalidation {
  item: CheckoutCartItem;
  productName: string;
  result: ProductSyncResult;
  refreshed: CatalogProduct | null;
}

function productDisplayName(item: CheckoutCartItem): string {
  return (
    item.catalog_products?.voice_name ||
    item.catalog_products?.amazon_name ||
    item.voicex_id ||
    'a product'
  );
}

/**
 * Phase 1 (parallel, read-only): look up fresh pricing for each item with a
 * bounded concurrency. No DB writes here so it is safe to run many in parallel.
 */
async function lookupItemsParallel(
  items: CheckoutCartItem[],
  concurrency: number,
): Promise<ItemRevalidation[]> {
  return mapWithConcurrency(items, concurrency, async (item) => {
    const productName = productDisplayName(item);
    let result: ProductSyncResult;
    try {
      result = await syncProductPriceFromAmazon(item.product_id, CHECKOUT_ACTOR);
    } catch (err) {
      // Defensive: syncProductPriceFromAmazon already converts failures into a
      // stale result, but never let one item's unexpected throw reject the whole
      // batch — degrade it to stale so the call still completes.
      const message = err instanceof Error ? err.message : 'Lookup failed';
      result = {
        productId: item.product_id,
        asin: item.catalog_products?.amazon_asin ?? null,
        priceChanged: false,
        oldAmazonCents: item.catalog_products?.amazon_price_cents ?? null,
        newAmazonCents: null,
        direction: null,
        availability: null,
        isPurchasable: false,
        becameUnavailable: false,
        oldStatus: null,
        newStatus: null,
        skipped: true,
        stale: true,
        staleReason: message,
        error: message,
      };
    }

    let refreshed: CatalogProduct | null = null;
    if (!result.stale && !result.becameUnavailable) {
      const { data } = await supabaseAdmin
        .from('catalog_products')
        .select('*')
        .eq('id', item.product_id)
        .maybeSingle();
      refreshed = (data as CatalogProduct | null) ?? null;
    }
    return { item, productName, result, refreshed };
  });
}

/**
 * Phase 2 (sequential, deterministic): apply each looked-up item's outcome -
 * remove unavailable items, write refreshed prices, and accumulate the
 * change/stale/remaining lists in cart order. Mutates the passed accumulator
 * arrays. Returns the per-item `ProductSyncResult`s so the caller can record
 * them on a sync run.
 */
async function applyItemRevalidations(
  looked: ItemRevalidation[],
  markupPercent: number,
  isWhitelisted: boolean,
  acc: {
    priceChanges: CheckoutRevalidationItemChange[];
    unavailable: CheckoutRevalidationUnavailable[];
    stale: CheckoutRevalidationStale[];
    remainingItems: CheckoutCartItem[];
  },
): Promise<ProductSyncResult[]> {
  const results: ProductSyncResult[] = [];
  for (const { item, productName, result, refreshed } of looked) {
    results.push(result);

    // Fresh pricing could not be verified (timeout / API error). Keep the item
    // in the order at its cached price so the call is never dropped, but record
    // it as stale for later review.
    if (result.stale) {
      acc.stale.push({
        cartItemId: item.id,
        productId: item.product_id,
        productName,
        reason: result.staleReason || 'Price not verified',
      });
      acc.remainingItems.push({ ...item });
      continue;
    }

    if (result.becameUnavailable) {
      acc.unavailable.push({ cartItemId: item.id, productId: item.product_id, productName });
      await supabaseAdmin.from('cart_items').delete().eq('id', item.id);
      continue;
    }

    let newUnitPrice = item.unit_price_cents;
    if (refreshed) {
      const computed = getProductPriceCents(refreshed, markupPercent, isWhitelisted);
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

      acc.priceChanges.push({
        cartItemId: item.id,
        productId: item.product_id,
        productName,
        oldUnitPriceCents: item.unit_price_cents,
        newUnitPriceCents: newUnitPrice,
        direction: newUnitPrice > item.unit_price_cents ? 'up' : 'down',
      });
    }

    acc.remainingItems.push({ ...item, unit_price_cents: newUnitPrice });
  }
  return results;
}

export interface RevalidateBatchResult {
  /** Per-item sync results for the processed slice (to record on a sync run). */
  results: ProductSyncResult[];
  priceChanges: CheckoutRevalidationItemChange[];
  unavailable: CheckoutRevalidationUnavailable[];
  stale: CheckoutRevalidationStale[];
  remainingItems: CheckoutCartItem[];
}

/**
 * Process a bounded slice of cart items for the checkout poll loop. Looks up
 * pricing in parallel (capped) and applies the outcomes deterministically. The
 * IVR poll handler calls this repeatedly across webhooks, accumulating the
 * results in the call session, then records one sync run at the end.
 *
 * This does NOT create or finalize a sync run; the poll loop owns that so the
 * report reflects the whole cart in a single run.
 */
export async function revalidateCartBatch(
  items: CheckoutCartItem[],
  context: CheckoutRevalidationContext,
  concurrency: number,
): Promise<RevalidateBatchResult> {
  const defaultMarkupPercent = await getDefaultMarkupPercent();
  const markupPercent = resolveEffectiveMarkup(defaultMarkupPercent, {
    custom_markup_percent: context.customMarkupPercent ?? null,
  });

  const acc = {
    priceChanges: [] as CheckoutRevalidationItemChange[],
    unavailable: [] as CheckoutRevalidationUnavailable[],
    stale: [] as CheckoutRevalidationStale[],
    remainingItems: [] as CheckoutCartItem[],
  };

  const looked = await lookupItemsParallel(items, concurrency);
  const results = await applyItemRevalidations(looked, markupPercent, context.isWhitelisted, acc);

  return { results, ...acc };
}

/**
 * Mark a list of items as stale (charged at cached price) without contacting
 * Rainforest. Used by the poll loop's safety valve when the verification budget
 * is exhausted before every item could be checked, so the call still completes.
 */
export function markItemsStale(items: CheckoutCartItem[], reason: string): RevalidateBatchResult {
  const stale: CheckoutRevalidationStale[] = [];
  const remainingItems: CheckoutCartItem[] = [];
  const results: ProductSyncResult[] = [];
  for (const item of items) {
    stale.push({
      cartItemId: item.id,
      productId: item.product_id,
      productName: productDisplayName(item),
      reason,
    });
    remainingItems.push({ ...item });
    results.push({
      productId: item.product_id,
      asin: item.catalog_products?.amazon_asin ?? null,
      priceChanged: false,
      oldAmazonCents: item.catalog_products?.amazon_price_cents ?? null,
      newAmazonCents: null,
      direction: null,
      availability: null,
      isPurchasable: false,
      becameUnavailable: false,
      oldStatus: null,
      newStatus: null,
      skipped: true,
      stale: true,
      staleReason: reason,
      error: reason,
    });
  }
  return { results, priceChanges: [], unavailable: [], stale, remainingItems };
}

/**
 * Persist a finished checkout revalidation as a `checkout`-trigger sync run when
 * anything changed or any item was stale, so unverified-pricing checkouts are
 * always auditable in the Product Sync report. Returns the run id (or null).
 */
export async function recordCheckoutSyncRun(
  context: CheckoutRevalidationContext,
  totalItems: number,
  results: ProductSyncResult[],
  changedCount: number,
  staleCount: number,
): Promise<string | null> {
  const shouldRecordRun = changedCount > 0 || staleCount > 0;
  if (!shouldRecordRun) return null;

  const runId = await createSyncRun({
    trigger: 'checkout',
    actor: CHECKOUT_ACTOR,
    total: totalItems,
    userId: context.userId,
    callerPhone: context.callerPhone,
  });
  if (!runId) return null;

  for (const result of results) {
    await addSyncRunItem(runId, result);
  }
  await finalizeSyncRun(runId, {
    total: totalItems,
    processed: totalItems,
    changed: changedCount,
  });
  return runId;
}

/**
 * Re-checks every cart item against Rainforest in one pass (parallel, capped).
 * Used by non-IVR callers and as the single-shot path. The live phone checkout
 * uses the poll loop (`revalidateCartBatch` + `recordCheckoutSyncRun`) instead
 * so a large cart never blocks one webhook.
 */
export async function revalidateCartAtCheckout(
  cartItems: CheckoutCartItem[],
  context: CheckoutRevalidationContext,
): Promise<CheckoutRevalidationResult> {
  const concurrency = config.priceSync.checkout.concurrency;
  const batch = await revalidateCartBatch(cartItems, context, concurrency);

  const hasChanges = batch.priceChanges.length > 0 || batch.unavailable.length > 0;
  const runId = await recordCheckoutSyncRun(
    context,
    cartItems.length,
    batch.results,
    batch.priceChanges.length + batch.unavailable.length,
    batch.stale.length,
  );

  return {
    hasChanges,
    priceChanges: batch.priceChanges,
    unavailable: batch.unavailable,
    stale: batch.stale,
    remainingItems: batch.remainingItems,
    runId,
  };
}
