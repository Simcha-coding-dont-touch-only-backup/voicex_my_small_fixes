# VoiceX Subscription Review Issues

Review date: 2026-06-15

Scope reviewed:

- `docs/voicex-subscription-specs.md`
- Subscription schema/cron migrations
- Shared subscription/alert types
- API subscription engine, cron, admin routes, IVR handlers, alerts
- Admin UI subscription management, queue, reports, users, products, orders, alerts

Verification run:

- `npm run lint` passed for `apps/api` and `apps/admin-web`.

No implementation files were changed as part of this review.

## Executive Summary

The implementation covers the broad feature shape: subscription packages by week, IVR flows, admin management, queue, reports, alert types, and cron endpoints exist. The main risks are in runtime business rules:

- Temporary pauses do not automatically resume.
- Pending queue rows are not consistently created, updated, or removed when package/card/address state changes.
- Empty packages can still become failed deliveries.
- The pre-run/partial fulfillment logic does not yet check Amazon availability or reduce quantities.
- Some admin filters/counts are based on delivery rows rather than truly subscribed active packages.
- Alert resolution is too broad and can hide unresolved delivery problems.

## Critical Issues

### 1. Temporary Pauses Never Auto-Resume

Severity: Critical

Evidence:

- `apps/api/src/lib/subscriptions.ts:533` defines `pauseDelivery`.
- `apps/api/src/lib/subscriptions.ts:559` stores `status: 'temp_paused'`.
- `apps/api/src/lib/subscriptions.ts:562` stores `pause_resume_date`.
- `apps/api/src/lib/subscriptions.ts:486` makes `ensureUpcomingRun` immediately return unless the delivery is `active`.
- `apps/api/src/lib/subscriptions.ts:600` runs `ensureAllUpcomingRuns`, but it only calls `ensureUpcomingRun`; it never reactivates `temp_paused` rows whose `pause_resume_date` has arrived.

Impact:

A delivery paused for 1 or 3 cycles remains paused forever unless an admin/user manually reactivates it. This breaks the spec's temporary pause behavior.

Suggested fix:

Add a scheduler step that finds `temp_paused` deliveries with `pause_resume_date <= current ET cycle date`, flips them back to `active`, clears pause fields, logs the event, and seeds the next pending run.

### 2. Package/Card/Address Changes Do Not Maintain Pending Runs

Severity: Critical

Evidence:

- Admin item changes call setters only:
  - `apps/api/src/modules/admin/subscriptions.ts:237`
  - `apps/api/src/modules/admin/subscriptions.ts:253`
  - `apps/api/src/modules/admin/subscriptions.ts:265`
  - `apps/api/src/modules/admin/subscriptions.ts:282`
- IVR item changes call setters only:
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers.ts:315`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-edit.ts:119`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-edit.ts:226`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-edit.ts:276`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-edit.ts:360`
- Card/address updates call setters only:
  - `apps/api/src/modules/admin/subscriptions.ts:351`
  - `apps/api/src/modules/admin/subscriptions.ts:355`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-manage.ts:166`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-manage.ts:189`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-manage.ts:260`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-manage.ts:382`
- None of those paths call `ensureUpcomingRun`, `recomputeNextCycleDate`, or `dropOpenRunsForDelivery`.

Impact:

The live package changes, but the queue does not reliably follow. Examples:

- Adding the first item after the daily pre-run but before midnight can miss the current cycle because no pending run is created before lock time.
- Adding/fixing a card or address before cutoff may not create the current cycle run if the delivery previously was not processable.
- Removing/clearing all items leaves an existing pending run behind.

Suggested fix:

Centralize subscription mutations through a helper that:

- Seeds a pending run when a delivery becomes processable.
- Drops pending/issue runs when a delivery becomes unprocessable because the package is empty.
- Recomputes `next_cycle_date`.
- Does not mutate already locked/processing snapshots.

### 3. Clearing a Package Can Produce a Failed Delivery

Severity: Critical

Evidence:

- Clear/remove flows do not delete open pending/issue runs:
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-edit.ts:276`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-edit.ts:360`
  - `apps/api/src/modules/admin/subscriptions.ts:265`
- Pre-run treats an empty package as an issue:
  - `apps/api/src/lib/subscription-engine.ts:197`
- Lock treats no shippable products as a hard failure:
  - `apps/api/src/lib/subscription-engine.ts:257`
  - `apps/api/src/lib/subscription-engine.ts:265`

Impact:

If a user removes all products from a package before cutoff, the expected result is that the delivery has nothing subscribed and should not process. Instead, a previously-created pending run can become `issue`, then `failed`, and create failed-delivery alerts.

Suggested fix:

When a package becomes empty, delete pending/issue runs for that delivery and set `next_cycle_date` to null until the package has items again.

### 4. Availability, Quantity Reduction, and Partial Fulfillment Are Not Implemented

Severity: Critical

Evidence:

- The engine comment says stock is skipped while Manual:
  - `apps/api/src/lib/subscription-engine.ts:129`
- `snapshotPackage` only skips disabled products:
  - `apps/api/src/lib/subscription-engine.ts:62`
  - `apps/api/src/lib/subscription-engine.ts:91`
- The only generated non-included status found in processing is `skipped_disabled`; no code writes `reduced` or `skipped_unavailable`.
- The spec requires 24-hour checks for Amazon availability/quantity and partial orders:
  - `docs/voicex-subscription-specs.md:203`
  - `docs/voicex-subscription-specs.md:208`

Impact:

The user-facing promise says unavailable products should be left out and reduced quantities should still ship as partial deliveries. The current engine cannot detect most of those cases, so it can over-promise, over-charge, or fail to show the required "left out" details.

Suggested fix:

Implement a product availability check before lock and/or during snapshot. Persist `reduced`, `skipped_unavailable`, original quantity, actual quantity, and reason on `subscription_delivery_run_items`, and make `partial` depend on those statuses.

## High Issues

### 5. Current-Cycle Runs Can Be Missed at the Cutoff

Severity: High

Evidence:

- `ensureAllUpcomingRuns` runs inside the lock endpoint:
  - `apps/api/src/modules/cron/routes.ts:58`
- `computeNextProcessingDate` is strictly after the current ET day:
  - `apps/api/src/lib/subscriptions.ts:50`
- `ensureUpcomingRun` uses that strict next date:
  - `apps/api/src/lib/subscriptions.ts:491`

Impact:

At midnight ET on a processing day, `ensureAllUpcomingRuns` will create next month's run, not today's run. That is correct for changes made after midnight, but dangerous if today's pending run was not already created before midnight. Any delivery that became processable after the last pre-run and before midnight can miss the current cycle.

Suggested fix:

When a delivery becomes processable before cutoff, seed that exact upcoming processing date immediately. At lock time, avoid relying on `ensureAllUpcomingRuns` to create due-today runs.

### 6. Subscription Management Status Filter Is Applied After Pagination

Severity: High

Evidence:

- The API fetches one paginated page first:
  - `apps/api/src/modules/admin/subscriptions.ts:139`
- Then it builds rows:
  - `apps/api/src/modules/admin/subscriptions.ts:146`
- Then it filters by status in memory:
  - `apps/api/src/modules/admin/subscriptions.ts:147`
- The UI asks for only `per_page=50`:
  - `apps/admin-web/src/pages/SubscriptionsPage.tsx:69`

Impact:

Filtering by `failed`, `temp_paused`, etc. can return incomplete or empty results if matching subscriptions are on later pages. The reported `total` is also the unfiltered subscription count.

Suggested fix:

Move status filtering into SQL or fetch/decorate all matching rows before paginating the filtered result.

### 7. Dashboard and User Subscription Counts Can Overcount Empty Deliveries

Severity: High

Evidence:

- Dashboard counts all `subscription_deliveries.status = active`:
  - `apps/api/src/modules/admin/dashboard.ts:82`
  - `apps/api/src/modules/admin/dashboard.ts:86`
- User list/detail counts active delivery rows, not active packages with items:
  - `apps/api/src/modules/admin/users.ts:52`
  - `apps/api/src/modules/admin/users.ts:60`
  - `apps/api/src/modules/admin/users.ts:81`
  - `apps/api/src/modules/admin/users.ts:84`
- Empty delivery rows can be created by admin ensure or IVR `getOrCreateDelivery`.

Impact:

The spec defines subscribing users as users with at least one active delivery/package. Empty active delivery rows can inflate:

- Dashboard "Subscribing Users"
- Dashboard "Deliveries"
- Users page subscription count
- User detail subscription box

Suggested fix:

Count active deliveries that have at least one `subscription_delivery_items` row, and count distinct users from those deliveries.

### 8. Alert Resolution Is Too Broad and Issue Clearing Is Incomplete

Severity: High

Evidence:

- Any card/address update resolves all open subscription alerts for the user:
  - `apps/api/src/modules/admin/subscriptions.ts:359`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-manage.ts:167`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-manage.ts:190`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-manage.ts:261`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-manage.ts:383`
- `resolveSubscriptionAlertsForUser` updates every unresolved alert of the selected types:
  - `apps/api/src/lib/subscription-alerts.ts:129`
  - `apps/api/src/lib/subscription-alerts.ts:135`
- Pre-run can clear a run's `issue_details`, but it does not resolve the related alert:
  - `apps/api/src/lib/subscription-engine.ts:166`

Impact:

Fixing a card can resolve unrelated product/address alerts. Separately, if a pre-run issue clears naturally, the admin alert can remain open. Both cases break the spec's alert status behavior and can hide unresolved delivery problems.

Suggested fix:

Resolve alerts by `run_id`/`delivery_id` and issue type after re-evaluating the run. Do not resolve all subscription alerts for the user from a single card/address change.

### 9. IVR "Reactivate This Delivery" From the Package Menu Routes to Pause Options

Severity: High

Evidence:

- The hear-package prompt changes wording based on paused state:
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers.ts:134`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers.ts:145`
- But pressing 6 always goes to `subscriptions_pause_options`:
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers.ts:180`
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers.ts:181`
- The actual reactivate path is `subscriptions_reactivate_confirm`:
  - `apps/api/src/modules/ivr/handlers/subscriptions-handlers-manage.ts:118`

Impact:

From the "hear this package" menu, a paused delivery tells the caller "To reactivate this delivery, press 6", but the next prompt asks them how long they want to pause it.

Suggested fix:

In `subscriptions_hear_full_action`, load the delivery state and route option 6 to `subscriptions_reactivate_confirm` when the delivery is not active.

### 10. Subscription Order Persistence Is Not Transactional Enough After Charge

Severity: High

Evidence:

- The code checks the initial order insert and marks manual review if that insert fails:
  - `apps/api/src/lib/subscription-engine.ts:426`
- But it does not check errors from inserting order items or order events:
  - `apps/api/src/lib/subscription-engine.ts:443`
  - `apps/api/src/lib/subscription-engine.ts:444`
- It does not check errors from inventory/sold-count RPC calls:
  - `apps/api/src/lib/subscription-engine.ts:451`
- It still marks the run processed/partial afterward:
  - `apps/api/src/lib/subscription-engine.ts:458`

Impact:

A card can be charged and the run can be marked processed while order items, events, or sold counts failed to persist. That would leave an incomplete order with money collected.

Suggested fix:

Check every persistence result after charge. Prefer a database RPC/transaction for order, items, events, run update, and product counters, with a clear manual-review state if any post-charge write fails.

## Medium Issues and Missing Spec Pieces

### 11. Queue Seeding Does Not Follow the "Next Week Only" Sequence

Severity: Medium

Evidence:

- The spec says the queue should show upcoming subscriptions of the next week delivery, then add the next week after the prior week processes:
  - `docs/voicex-subscription-specs.md:197`
  - `docs/voicex-subscription-specs.md:198`
- `ensureAllUpcomingRuns` loops through every delivery of every subscription:
  - `apps/api/src/lib/subscriptions.ts:600`
  - `apps/api/src/lib/subscriptions.ts:605`

Impact:

The queue can contain pending runs for all four weekly delivery slots at once instead of only the next delivery wave. This may be acceptable operationally, but it does not match the spec wording.

Suggested fix:

Decide whether "one pending run per active delivery" is the intended behavior. If not, constrain `ensureAllUpcomingRuns` to only the next upcoming processing day/week.

### 12. Queue Pending Rows Do Not Show Useful Product/Cost Totals Before Lock

Severity: Medium

Evidence:

- Queue decoration counts run snapshot items:
  - `apps/api/src/modules/admin/subscription-queue.ts:18`
- Pending runs have no `subscription_delivery_run_items` until lock/snapshot.
- The queue UI shows `total_cents`, which remains 0 before processing:
  - `apps/admin-web/src/pages/SubscriptionsPage.tsx:261`
- The spec requires customer, total products, total cost, and estimated processing for queue rows:
  - `docs/voicex-subscription-specs.md:199`
  - `docs/voicex-subscription-specs.md:201`

Impact:

Pending queue rows can look empty or $0 until lock time, limiting usefulness for the admin pre-run workflow.

Suggested fix:

For `pending`/`issue` rows, compute totals from the live delivery package. For locked/processed rows, use the immutable snapshot.

### 13. Admin Package Transfer Allows Destinations That Already Contain the Product

Severity: Medium

Evidence:

- The UI offers all other weeks, without checking whether the product already exists there:
  - `apps/admin-web/src/components/subscriptions/PackageModal.tsx:120`
  - `apps/admin-web/src/components/subscriptions/PackageModal.tsx:182`
- The API validates only `to_week` range:
  - `apps/api/src/modules/admin/subscriptions.ts:274`
- `transferDeliveryItem` merges quantities if the destination already has the product:
  - `apps/api/src/lib/subscriptions.ts:296`

Impact:

The spec says transfer destinations should skip packages that already contain the product. Admin transfer can merge quantities instead. A direct API call with the same source week would also delete the item after doubling it, because source and destination are the same row path.

Suggested fix:

Validate destination week is different from source week, and reject destinations that already contain the product. Have the UI hide those destination buttons.

### 14. Admin Checkout Popup Cannot Add a New Card or Address

Severity: Medium

Evidence:

- The popup only renders saved-address and saved-card selects:
  - `apps/admin-web/src/components/subscriptions/CheckoutModal.tsx:70`
  - `apps/admin-web/src/components/subscriptions/CheckoutModal.tsx:79`
- It explicitly tells admins to add them on the customer user page:
  - `apps/admin-web/src/components/subscriptions/CheckoutModal.tsx:85`
- The spec says the checkout popup can select another saved address/card or add a new one.

Impact:

Admin workflows require leaving the subscription checkout popup, editing the user, then returning.

Suggested fix:

Reuse or embed the user detail address/card add forms inside the checkout modal.

### 15. Admin Add Product Flow Does Not Prompt for Quantity

Severity: Medium

Evidence:

- Package modal always adds quantity 1:
  - `apps/admin-web/src/components/subscriptions/PackageModal.tsx:109`
- The spec says admin should search, click add, select quantity, then add:
  - `docs/voicex-subscription-specs.md:190`

Impact:

Admins can still edit quantity after adding, but the flow is not what the spec describes and is easy to mis-save at quantity 1.

Suggested fix:

Show a quantity input/stepper before submitting the add request.

### 16. Failed/Skipped Alert Lifecycle Is Incomplete

Severity: Medium

Evidence:

- The IVR marks an alert heard before the caller chooses retry/skip:
  - `apps/api/src/modules/ivr/handlers/subscriptions-alerts-inbox.ts:90`
- Skip changes only the run status:
  - `apps/api/src/lib/subscription-engine.ts:602`
  - `apps/api/src/modules/ivr/handlers/subscriptions-alerts-inbox.ts:163`
- No code resolves the alert when the run is skipped.

Impact:

The user will not hear the alert again because it is heard, but the admin-facing open alert count can still show it unresolved after the delivery was skipped.

Suggested fix:

When retry succeeds or skip is confirmed, resolve the alert tied to that run/delivery.

### 17. Product and Paused Reports May Use Inconsistent Price Semantics

Severity: Medium

Evidence:

- Paused report prices use `custom_price_cents ?? amazon_price_cents`:
  - `apps/api/src/modules/admin/reports.ts:76`
- Subscription package pricing elsewhere uses `getProductPriceCents` with markup and whitelist awareness:
  - `apps/api/src/lib/subscriptions.ts:333`

Impact:

Paused subscription report totals can differ from the prices shown in subscription management and from what would be charged.

Suggested fix:

Reuse the subscription pricing helper or snapshot the intended package total when pausing.

## Lower Priority / Clarifications

### 18. Entering the Subscription Menu Creates a Subscription Row

Severity: Low

Evidence:

- `subscriptions_entry` calls `getSubscriptionCtx`.
- `getSubscriptionCtx` calls `getOrCreateSubscription`.
- `apps/api/src/modules/ivr/handlers/subscriptions-handlers.ts:59`
- `apps/api/src/modules/ivr/handlers/subscriptions-shared.ts:105`

Impact:

Users who only visit the subscription menu can appear in subscription management with zero products. This may be acceptable for setup, but it can clutter admin pages unless filtered out.

Suggested fix:

Either create the row only on first meaningful subscription action, or filter management/dashboard counts to packages with at least one item.

### 19. No Automated Behavioral Tests Cover Subscription Edge Cases

Severity: Low

Evidence:

- TypeScript lint passes, but the reviewed edge cases are runtime business rules.
- No subscription-specific automated test files were found in the repo scan.

Impact:

The highest-risk rules are date/cutoff, pause/resume, queue state, alert lifecycle, and payment/order persistence. These are easy to regress without tests.

Suggested fix:

Add focused tests around:

- Temporary pause resume.
- Add/remove/clear package queue maintenance.
- Late pre-cutoff processability changes.
- Alert resolve/retry/skip lifecycle.
- Partial snapshot generation.
- Post-charge persistence failure handling.
