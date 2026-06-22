import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

export const config = {
  port: parseInt(process.env.API_PORT || '3001', 10),
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
  adminUrl: process.env.ADMIN_URL || 'http://localhost:5173',

  supabase: {
    url: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  },

  teltech: {
    apiAuth: process.env.TELTECH_API_AUTH || '',
  },

  sola: {
    apiKey: process.env.SOLA_API_KEY!,
  },

  rye: {
    apiKey: process.env.RYE_API_KEY!,
  },

  rainforest: {
    apiKey: process.env.RAINFOREST_API_KEY!,
  },

  google: {
    addressValidationApiKey: process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY!,
  },

  defaults: {
    markupPercent: parseInt(process.env.DEFAULT_MARKUP_PERCENT || '15', 10),
  },

  // Shared secret that pg_cron (via pg_net) must present to call the protected
  // subscription cron endpoints.
  cron: {
    secret: process.env.CRON_SECRET || '',
  },

  subscriptions: {
    // Delay between processing each delivery run so the midnight batch is spread
    // out instead of hammering the gateway all at once.
    processSpacingMs: parseInt(process.env.SUBSCRIPTION_PROCESS_SPACING_MS || '4000', 10),
    // How often the in-process worker polls for due (locked) runs to drain.
    workerPollMs: parseInt(process.env.SUBSCRIPTION_WORKER_POLL_MS || '15000', 10),
    // Serverless drain (Supabase pg_cron-triggered): max runs processed per
    // invocation and the wall-clock budget so each call returns inside the
    // serverless function timeout. The scheduler fires frequently to continue
    // draining whatever is still locked.
    drainBatchSize: parseInt(process.env.SUBSCRIPTION_DRAIN_BATCH_SIZE || '8', 10),
    drainTimeBudgetMs: parseInt(process.env.SUBSCRIPTION_DRAIN_TIME_BUDGET_MS || '50000', 10),
  },

  priceSync: {
    // Delay between each Rainforest product lookup so a sync run is spread out
    // instead of hammering the Rainforest API.
    spacingMs: parseInt(process.env.PRICE_SYNC_SPACING_MS || '1500', 10),
    // Hard per-lookup timeout for a single Rainforest product request. Checkout
    // revalidation no longer blocks the call on the whole cart (it runs in a
    // bounded poll loop, see checkout below), so this can be generous enough to
    // let most products verify. On timeout, checkout falls back to the cached
    // catalog price and flags the item as stale in the sync report.
    lookupTimeoutMs: parseInt(process.env.PRICE_SYNC_LOOKUP_TIMEOUT_MS || '8000', 10),
    // Checkout-time revalidation runs inside a TelTech "please hold" poll loop.
    // Each poll drains a bounded batch of cart items, with up to `checkoutConcurrency`
    // Rainforest lookups in flight at once, until either the per-poll wall-clock
    // budget is hit or the cart queue empties. The loop repeats across at most
    // `checkoutMaxPolls` webhooks so it can never exceed TelTech's per-call
    // webhook cap; remaining unverified items then fall back to cached pricing.
    checkout: {
      concurrency: parseInt(process.env.PRICE_SYNC_CHECKOUT_CONCURRENCY || '5', 10),
      pollTimeBudgetMs: parseInt(process.env.PRICE_SYNC_CHECKOUT_POLL_BUDGET_MS || '7000', 10),
      maxPolls: parseInt(process.env.PRICE_SYNC_CHECKOUT_MAX_POLLS || '8', 10),
    },
    // Serverless drain (Supabase pg_cron-triggered every couple of minutes): the
    // max products processed per invocation and the wall-clock budget so each
    // call returns inside the serverless function timeout. The drain cron fires
    // frequently to continue an in-progress run until its queue is empty.
    drainBatchSize: parseInt(process.env.PRICE_SYNC_DRAIN_BATCH_SIZE || '15', 10),
    drainTimeBudgetMs: parseInt(process.env.PRICE_SYNC_DRAIN_TIME_BUDGET_MS || '45000', 10),
    // A 'running' scheduled run with no progress for longer than this is treated
    // as dead (process killed mid-batch) and reconciled to 'failed'.
    staleRunMinutes: parseInt(process.env.PRICE_SYNC_STALE_RUN_MINUTES || '15', 10),
  },
} as const;
