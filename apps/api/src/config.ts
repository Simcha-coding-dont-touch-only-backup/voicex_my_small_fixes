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
  },
} as const;
