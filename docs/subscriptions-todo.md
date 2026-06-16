BS"D

Good question. The code is complete and builds, but "working in production" needs a few config, deployment, verification, and one code-risk item. Here's the honest punch list, ordered by what blocks it.

✅ 1. Config required before anything fires (blocking)
Set CRON_SECRET in the API's .env.
Insert the matching secret + public API URL into Supabase so the cron jobs stop no-op'ing:
insert into private.cron_settings(key, value) values
  ('api_base_url', 'https://your-public-api-domain'),
  ('cron_secret',  '<same as CRON_SECRET>')
on conflict (key) do update set value = excluded.value;


2. Deployment prerequisites (blocking)
The API must be publicly reachable from Supabase. pg_net makes an outbound HTTPS call to api_base_url; if the API is on localhost or behind a private network, the cron can't reach it. Confirm the production API URL is internet-reachable.

Processing on Vercel serverless (current setup): the in-process worker startSubscriptionWorker() does NOT run on Vercel (guarded by process.env.VERCEL !== '1'). Instead, charging + order creation is driven by a frequent Supabase pg_cron job (subscriptions_drain, every 2 min) that calls the protected, bounded POST /api/cron/subscriptions/drain endpoint. Each call processes a small batch of locked runs within a wall-clock budget (config: SUBSCRIPTION_DRAIN_BATCH_SIZE, SUBSCRIPTION_DRAIN_TIME_BUDGET_MS) so it finishes inside the serverless function timeout; the next tick continues draining. The endpoint is idempotent and claims runs atomically, so overlapping fires are safe. The lock endpoint also kicks off one awaited bounded drain so processing starts promptly at midnight.
Cron jobs (Supabase pg_cron): subscriptions_prerun (daily), subscriptions_lock (midnight-ET window), subscriptions_drain (every 2 min).
Alternative (only if you leave Vercel): deploy the API as a long-running Express server and the in-process worker drains automatically; the drain cron is then redundant but harmless (idempotent).


3. One code risk to verify (potentially blocking — affects ALL logins)
Every PIN/registration success now routes through subscriptions_alerts_announce, which (when there are no alerts) returns buildSay('', ... main_menu) — i.e. an empty TTS say followed by a redirect. buildSay always emits a say action even with empty text, and there's no existing precedent in this codebase for an empty say. If TelTech rejects/garbles an empty say, login would break for everyone. This needs a live-call check, and I'd recommend a one-line safe fix (make buildSay/a new buildRedirect omit the say action when the message is empty). I can do that immediately — it's the highest-risk item.

4. End-to-end testing (nothing has been runtime-tested, only type-checked)
IVR: place a real TelTech call, press 5, and walk add / hear / edit / transfer / remove / pause / address / card / explanation, plus the post-PIN alerts inbox. Watch TelTech's per-call limits (.details.md notes max ~50 actions / 25 webhook calls / recursion 100) on long subscription sessions.
Engine: to exercise charge → manual order without waiting for a real processing date, you can POST /api/cron/subscriptions/ensure (seeds pending runs) and then either wait for the 1st/8th/15th/22nd or temporarily set a run's cycle_date to today and hit /lock. Verify the worker drains it, the manual order is created, and statuses/alerts/history land correctly. (Tell me if you want a small admin-only "process now / test run" button to make this easier.)
Real Sola charge: confirm solaSaleRecurring actually settles against a real stored token.


5. External confirmation (not code)
Confirm with Cardknox/Sola that merchant-initiated recurring charges on a stored token without CVV are enabled on the account. The code sends xRecurringIndicator: 'Recurring', but issuer/account enablement is an account-side setting.


6. Intentional limitations still open (only matter once you have the Amazon API)
The 24h pre-run check verifies card expiry, address, and product-enabled status — but not live Amazon stock/availability (no API yet). So "Products Unavailable" / "QTY Unavailable" detection and the partial-order/quantity-reduction path are wired but won't actually trigger until the Amazon Partner API is integrated into processRun's charge→fulfill step (kept isolated for exactly this).
No live Sola card-validity ping in pre-run (expiry-only), per the plan.
"Amazon Order ID" in the queue is admin-entered during manual fulfillment (existing Fulfillment flow), not auto-populated.


7. Optional polish (non-blocking)
A fresh Supabase environment would need the three migration SQL files applied (they exist in supabase/migrations/); the remote project already has them.
resolveSubscriptionAlertsForUser on a card/address change currently resolves all of a user's subscription alerts; could scope strictly to card/address issue types.
Subscriptions admin is requireFullAdmin; add a permission key if sub-admins should access it.
Want me to (a) fix the empty-say post-PIN risk now, and/or (b) add a small admin "test/process-now" control to make end-to-end verification easy? Those are the two I'd do before any live call.