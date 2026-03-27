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

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER!,
    payConnector: process.env.TWILIO_PAY_CONNECTOR || 'Default',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY!,
  },

  rye: {
    apiKey: process.env.RYE_API_KEY!,
    baseUrl: process.env.RYE_BASE_URL || 'https://staging.api.rye.com',
  },

  google: {
    addressValidationApiKey: process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY!,
  },

  defaults: {
    markupPercent: parseInt(process.env.DEFAULT_MARKUP_PERCENT || '15', 10),
  },
} as const;
