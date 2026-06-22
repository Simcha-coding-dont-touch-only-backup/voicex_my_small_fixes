# Rainforest Price Sync QA Review

Date: 2026-06-18
Resolution status update: 2026-06-22

Reviewed against `.cursor/plans/rainforest_price_sync_a929089f.plan.md`.

Checks run:
- `npm run build` - passed
- `npm run lint` - passed

No source code changes were made as part of the original 2026-06-18 review.

## Resolution status (2026-06-22)

| Finding | Severity | Status |
| --- | --- | --- |
| Checkout can still proceed with products Rainforest cannot sell | P0 | Not addressed |
| Checkout ignores Rainforest API failures and charges using stale data | P0 | Addressed differently (see note) |
| Checkout can leave stale Amazon cost on cart/order items | P1 | Not addressed |
| Scheduled sync 4AM Eastern + sub-day intervals | P1 | Partially resolved |
| Full sync jobs are not durable / scheduled sync times out | P1 | Resolved |
| Checkout revalidation hangs the call when Rainforest is slow | P0 | Resolved |
| Product Sync report violates pagination helper contract | P2 | Not addressed |
| Null Amazon prices display as `$0.00` in reports | P2 | Not addressed |
| Product history does not identify which price field changed | P3 | Not addressed |

Note: line numbers in the findings below predate the 2026-06-22 durability fix and
may be stale in `apps/api/src/lib/product-sync.ts`, `apps/api/src/modules/cron/routes.ts`,
and `apps/api/src/modules/admin/catalog.ts`.

## Findings

### P0 - Checkout can still proceed with products that Rainforest cannot sell

Affected code:
- `apps/api/src/lib/product-sync.ts:192-199`
- `apps/api/src/lib/product-sync.ts:570-586`
- `apps/api/src/lib/rainforest.ts:90-112`

Issue:
`syncProductPriceFromAmazon()` only sets `becameUnavailable` when Rainforest maps availability to `out_of_stock`. It does not treat these cases as unavailable:
- Rainforest returns no product / ASIN not found.
- Rainforest returns `is_purchasable: false`.
- Rainforest returns unknown availability.
- Rainforest returns no buybox price (`price_cents === null`).

Checkout only removes items when `result.becameUnavailable` is true. If the refreshed product has no computable price, checkout keeps the old cart unit price and allows the customer to continue.

Impact:
This violates the requirement that checkout should tell the caller when products are no longer available and remove them from the order. A beta user can still pay for an item that Amazon no longer exposes, cannot price, or cannot sell.

Suggested fix:
For checkout revalidation, treat a product as unavailable when any of these are true:
- lookup returned null / ASIN not found
- `availability === 'out_of_stock'`
- `isPurchasable === false`
- `newAmazonCents === null`

Return a structured unavailable reason from `syncProductPriceFromAmazon()` and use it in `revalidateCartAtCheckout()`. Also make `addSyncRunItem()` record these as unavailable report items.

### P0 - Checkout ignores Rainforest API failures and charges using stale data

Status: Addressed differently (2026-06-22). The original suggested fix was to
*block* the payment flow when pricing could not be verified. We instead chose a
**reliability-first** approach after this exact path took down live phone
payments: when a Rainforest lookup fails or times out, checkout now proceeds on
the cached catalog price (the customer is not stranded mid-call) and the item is
explicitly flagged as "not verified" so it can be reviewed after the fact.

Rationale for the product decision: on 2026-06-22 callers were hung up at the
"one moment while we process your order" step because `final_confirm` ran
synchronous, unbounded, per-item Rainforest lookups inside a TelTech webhook
(~10s `api_timeout`). Blocking on "could not verify" would convert every
Rainforest slowdown into a failed checkout. Charging the cached price and
flagging it keeps orders flowing while preserving an audit trail. (See the new
"Checkout revalidation hangs the call when Rainforest is slow" finding below for
the hang root cause and timeout fix.)

What changed (the "could not verify" signal now exists and is surfaced):
- `syncProductPriceFromAmazon()` now distinguishes a failed/timed-out lookup
  (`ProductSyncResult.stale = true`, plus `staleReason`) from a verified
  no-change result. The cached `amazon_price_cents` is left intact.
- `revalidateCartAtCheckout()` collects a `stale[]` list, keeps those items in
  the order at their cached price, and **always records a `checkout` sync run
  when any item is stale** (previously a run was created only on real changes).
- `addSyncRunItem()` persists `stale` / `stale_reason`
  (`product_sync_run_items` columns added in
  `supabase/migrations/20260622162000_product_sync_run_items_stale.sql`).
- `final_confirm` logs a `checkout_revalidation_stale` event (severity `warn`)
  and links the run; the caller hears nothing different and pays the cached
  price.
- The Product Sync report (API + admin Reports → Product Sync) shows an amber
  "Not verified" badge and the reason for stale items.

Affected code (original):
- `apps/api/src/lib/product-sync.ts:179-190`
- `apps/api/src/lib/product-sync.ts:567-611`
- `apps/api/src/modules/ivr/handlers/checkout-handlers.ts:1280-1336`

Original issue (for reference):
Rainforest transport/auth/rate-limit errors are converted into
`ProductSyncResult.error`, but `revalidateCartAtCheckout()` does not treat errors
as blocking. It continues with the old cart item and only marks `hasChanges`
when a cart price changed or an item was removed.

Not done / open: if the product decision ever flips to safety-first (block
checkout on unverified pricing), the `stale` signal is already plumbed through
and `final_confirm` could fail-fast on it instead of proceeding.

### P0 - Checkout revalidation hangs the call when Rainforest is slow

Status: Resolved (2026-06-22). Found while diagnosing a live incident: phone
payments stopped working and callers were hung up right after "one moment while
we process your order."

Root cause (confirmed from production logs):
- `final_confirm` (manual path) calls `revalidateCartAtCheckout()`, which does a
  synchronous Rainforest **product** API lookup per cart item.
- `fetchRainforestProduct()` had **no timeout** on its `fetch()`. The Rainforest
  real-time product endpoint routinely takes 6-7s per ASIN (measured from
  `manual_single` sync runs) and was degraded that day (the 08:00 auto full sync
  ran ~4.4h then failed).
- This all runs inside the `checkout_confirm` -> `checkout_final_confirm`
  redirect webhook, which TelTech holds open synchronously with a ~10s
  `api_timeout`. On 2026-06-21 (working) that hop took 12-22s; on 2026-06-22
  (broken) it took ~60s. TelTech gave up and hung up before `checkout_pay` ever
  ran. Sessions were left stranded at `current_node_key = checkout_final_confirm`
  with no auth, no order, and no error logged (TelTech error/hangup webhooks are
  also not firing - see `.details.md`).

Fix:
- Added a hard per-lookup timeout via `AbortController` in
  `fetchRainforestProduct()` (default 4s, configurable via
  `config.priceSync.lookupTimeoutMs` / `PRICE_SYNC_LOOKUP_TIMEOUT_MS`), well
  under TelTech's `api_timeout`. Timeouts throw
  `RainforestProductLookupError` with `timedOut = true`.
- On timeout/error the item is treated as `stale` and checkout proceeds on the
  cached price (see the P0 "charges using stale data" note above), so a slow
  Rainforest can no longer drop the call.

Affected code (resolved):
- `apps/api/src/lib/rainforest.ts` (`fetchRainforestProduct`, `RainforestProductLookupError.timedOut`)
- `apps/api/src/config.ts` (`priceSync.lookupTimeoutMs`)
- `apps/api/src/lib/product-sync.ts` (`syncProductPriceFromAmazon`, `revalidateCartAtCheckout`)

Not done / possible follow-ups:
- Per-item lookups are still sequential. A large cart at ~4s/item could still be
  slow; parallelizing with a small concurrency cap would add margin.
- The `checkout_confirm` -> `checkout_final_confirm` step is a bare
  `say` + `redirect` that holds one webhook open for the whole revalidation.
  Restructuring it so TelTech is never waiting on a long webhook (e.g. a hold
  loop) would be more robust than relying on the per-lookup timeout alone.
- TelTech error/hangup notifications are not firing, so these drops were silent;
  worth fixing so future regressions are visible.

### P1 - Checkout can leave stale Amazon cost on cart/order items

Affected code:
- `apps/api/src/lib/product-sync.ts:589-596`
- `apps/api/src/lib/product-sync.ts:611-625`
- `apps/api/src/modules/ivr/handlers/checkout-handlers.ts:2192-2197`

Issue:
During checkout revalidation, `cart_items.amazon_price_cents` is updated only inside the `if (newUnitPrice !== item.unit_price_cents)` block. If Amazon price changes but the customer's VoiceX price does not change, for example because the product has a manual custom price, the cart item keeps the old Amazon price.

The checkout sync run is also only created when `priceChanges.length > 0 || unavailable.length > 0`, so an Amazon price change that does not change the customer's unit price is missing from the Product Sync report.

Impact:
Manual fulfillment and profit/return reporting can snapshot stale Amazon cost into `order_items.amazon_price_cents`, even though the catalog Amazon price was refreshed.

Suggested fix:
Always update `cart_items.amazon_price_cents` when the refreshed catalog Amazon price differs from the cart snapshot, independent of whether `unit_price_cents` changed. Include `results.some(r => r.priceChanged)` in checkout `hasChanges` so checkout-triggered Amazon price changes appear in `product_sync_runs`.

### P1 - Scheduled sync does not honor 4AM Eastern correctly and sub-day intervals cannot work

Status: Partially resolved (2026-06-22). The scheduled sync is now durable and
resumable (see the durability finding below), but the timezone/cadence problems
in this finding are unchanged:
- The 3AM-vs-4AM EST gating bug still stands. The cron still fires `0 8,9 * * *`
  (UTC) and the endpoint still gates by UTC calendar day, so the first fire of
  the UTC day wins.
- Sub-day interval options (`1`, `3`, `10` hours) still cannot run at their
  selected cadence, since the daily cron only fires once per day. Note: the new
  `catalog_price_sync_drain` cron added on 2026-06-22 runs every 2 minutes, but
  it only *continues* an already-started run; it does not start new runs, so it
  does not enable sub-day start cadences.

Affected code:
- `supabase/migrations/20260618211326_catalog_price_sync_cron.sql:10-13`
- `supabase/migrations/20260622121000_catalog_price_sync_durable_batches.sql`
- `apps/api/src/modules/cron/routes.ts` (price-sync start handler, interval gating)

Issue:
The cron fires every day at both `08:00` and `09:00` UTC. The endpoint uses UTC calendar-day gating, so the first firing of the UTC day wins.

During EST, `08:00 UTC` is 3AM Eastern and `09:00 UTC` is 4AM Eastern. Because the 3AM run writes the full-sync row first, the correct 4AM run is skipped.

Also, the setting allows `1`, `3`, and `10` hour intervals, but the cron only fires once per day around the 8/9 UTC window. Those interval options therefore cannot run at the selected cadence.

Impact:
The auto sync can run at 3AM Eastern during standard time, and interval settings under 24 hours are effectively misleading.

Suggested fix:
Use timezone-aware scheduling/gating. Options:
- Schedule hourly and gate in the API by Eastern local time plus interval.
- Use separate seasonal cron schedules if the platform cannot express `America/New_York`.
- Remove sub-day interval options if the product decision is "only run around 4AM Eastern."

### P1 - Full sync jobs are not durable and scheduled sync is likely to time out

Status: Resolved (2026-06-22). Confirmed in production data: the daily cron had
been firing correctly every day, but each `auto`/`manual_full` run was awaited
inline and killed by the serverless function timeout after ~5 products, leaving
the run row stuck in `running` forever. A stuck row then blocked subsequent runs
via the interval gate and never rendered as failed/red.

Fix (durable, resumable, DB-backed job model mirroring the subscription drain):
- `startScheduledFullSync()` computes the eligible product set, persists it as
  the run's `pending_product_ids` queue, and returns immediately. `/sync/start`
  and the daily cron no longer await the full loop.
- `drainScheduledSync()` processes a bounded batch per invocation (default 15
  products / 45s wall-clock budget), persisting progress and the shrunken queue
  after every product, and finalizes the run `completed` when the queue empties.
- New `catalog_price_sync_drain` pg_cron job (`*/2 * * * *`) continues an
  in-progress run across invocations until done; the daily job only starts runs.
- Progress, pause state, and a `last_progress_at` heartbeat are persisted to
  `product_sync_runs`. An atomic lease on `last_progress_at` prevents overlapping
  drain ticks from double-processing, so it is safe across instances/serverless.
- `reconcileStaleScheduledRuns()` runs on every drain tick and marks runs with a
  stale heartbeat (>15 min) as `failed`, so dead runs go red promptly instead of
  lingering as `running`.
- `getSyncJobStateResolved()` makes `/sync/status` DB-aware so the admin
  "Syncing..." bar stays live between drain ticks (no longer single-instance
  in-memory only).
- One-time cleanup: the stuck `auto` run from 2026-06-22 08:00 was reconciled to
  `failed`.

Affected code (resolved):
- `supabase/migrations/20260622121000_catalog_price_sync_durable_batches.sql` (new)
- `apps/api/src/lib/product-sync.ts` (`startScheduledFullSync`, `drainScheduledSync`, `reconcileStaleScheduledRuns`, `getSyncJobStateResolved`, `pauseScheduledSync`)
- `apps/api/src/modules/cron/routes.ts` (price-sync start + new price-sync-drain endpoints)
- `apps/api/src/modules/admin/catalog.ts` (`/sync/start`, `/sync/status`, `/sync/pause`)
- `apps/api/src/config.ts` (`priceSync` batch knobs)

Original finding (for reference):

Affected code:
- `supabase/migrations/20260615161749_subscriptions_cron.sql:45-52`
- `apps/api/src/modules/cron/routes.ts:133-138`
- `apps/api/src/modules/admin/catalog.ts:1340-1351`
- `apps/api/src/lib/product-sync.ts:419-470`

Issue:
The pg_net helper uses an 8 second HTTP timeout, but the cron endpoint awaits `runFullSync()`. `runFullSync()` is sequential, calls Rainforest for each product, and waits 1.5 seconds between products.

Manual "Sync Now" is fire-and-forget in process memory. That only works reliably on a long-lived Node process. It is not durable across API restarts, multiple instances, or serverless execution.

Impact:
Scheduled full sync can time out after only a few products. In serverless or multi-instance deployments, manual full sync can stop early, lose progress, or report stale in-memory status.

Suggested fix:
Move full sync to a durable DB-backed job model:
- `POST /sync/start` and cron should create/enqueue a job and return quickly.
- A worker or bounded cron batch should claim products and process them in chunks.
- Persist progress, pause state, current product, and errors in the database instead of only memory.
- Keep the in-memory status as a cache only if the API is guaranteed single-instance and long-lived.

### P2 - Product Sync report violates the pagination helper contract

Affected code:
- `apps/api/src/lib/fetch-all-rows.ts:13-16`
- `apps/api/src/modules/admin/reports.ts:341-347`

Issue:
`fetchAllRows()` explicitly requires the callback to return a fresh PostgREST query builder each time. The Product Sync report builds one `query` variable and passes `() => query`, reusing the same builder across pages.

Impact:
Once product sync runs exceed 1000 rows, this can mis-page or silently truncate report data depending on how the Supabase builder mutates `.range()`.

Suggested fix:
Move the Product Sync query construction inside the `fetchAllRows()` callback so every page starts from a fresh builder with the same filters and ordering.

### P2 - Null Amazon prices display as `$0.00` in reports

Affected code:
- `apps/admin-web/src/pages/ReportsPage.tsx:28-29`
- `apps/admin-web/src/pages/ReportsPage.tsx:399-407`

Issue:
The report `money()` helper treats `null` as zero. If a product loses its Amazon price but is not marked `became_unavailable`, the report can show the new Amazon price as `$0.00` and a green "Down" change.

Impact:
Admins may read a missing buybox/no-price condition as a valid zero-dollar price drop.

Suggested fix:
Render `null` Amazon prices as `N/A` or `No price`. If `new_amazon_price_cents` is null, either mark the item unavailable or show a distinct missing-price state instead of green price-down styling.

### P3 - Product history does not identify which price field changed

Affected code:
- `apps/api/src/lib/product-sync.ts:93-109`
- `apps/api/src/modules/admin/catalog.ts:784-804`

Issue:
Both Amazon price changes and manual custom price changes are stored as `change_type = 'price'` with only old/new values. The history modal cannot tell the admin whether the Amazon price changed, the custom price changed, or another price field changed.

Impact:
The history popup meets the broad "price changes" requirement, but it is ambiguous during debugging and support.

Suggested fix:
Add a `field` or `metadata` column to `product_history` for price changes, for example `amazon_price_cents`, `custom_price_cents`, or `status`. Display that label in the modal.

## Positive Notes

- Build and TypeScript checks pass.
- The settings toggle, interval dropdown, Sync Now/Pause UI, row sync icon, bulk sync, history modal, and Product Sync report are wired end to end.
- Auto sync loads active products only and uses the 12-hour `updated_at` skip when called from cron.
- Existing auto-freeze/alert behavior is reused through `syncProductCatalogAlerts()`.
