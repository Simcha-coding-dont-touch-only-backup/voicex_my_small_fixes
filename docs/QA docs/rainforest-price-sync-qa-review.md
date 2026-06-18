# Rainforest Price Sync QA Review

Date: 2026-06-18

Reviewed against `.cursor/plans/rainforest_price_sync_a929089f.plan.md`.

Checks run:
- `npm run build` - passed
- `npm run lint` - passed

No source code changes were made as part of this review.

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

Affected code:
- `apps/api/src/lib/product-sync.ts:179-190`
- `apps/api/src/lib/product-sync.ts:567-611`
- `apps/api/src/modules/ivr/handlers/checkout-handlers.ts:1280-1336`

Issue:
Rainforest transport/auth/rate-limit errors are converted into `ProductSyncResult.error`, but `revalidateCartAtCheckout()` does not treat errors as blocking. It continues with the old cart item and only marks `hasChanges` when a cart price changed or an item was removed.

Impact:
If Rainforest is down, rate-limited, or misconfigured, checkout behaves as if there were no price or availability changes. That is risky for the beta manual-order flow because customers can be charged using stale Amazon prices.

Suggested fix:
Checkout should distinguish "verified no change" from "could not verify." For checkout-triggered syncs, collect lookup errors and stop the payment flow with a voice prompt such as "We could not verify current pricing for your order. Please try again later." Do not proceed to `checkout_pay` unless every cart product was verified or intentionally removed.

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

Affected code:
- `supabase/migrations/20260618211326_catalog_price_sync_cron.sql:10-13`
- `apps/api/src/modules/cron/routes.ts:112-127`

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
