import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import './modules/ivr/init-handlers.js';
import { teltechRouter } from './modules/teltech/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { webhookRouter } from './modules/orders/webhook-routes.js';
import { contactRouter } from './modules/contact/routes.js';
import { cronRouter } from './modules/cron/routes.js';
import { handleCallStatus } from './modules/teltech/handlers/call-status.js';
import { handleErrorWebhook } from './modules/teltech/handlers/error-webhook.js';
import { startSubscriptionWorker } from './lib/subscription-engine.js';

const app = express();

// TelTech fire-and-forget webhooks — mounted before ANY middleware
// to guarantee no helmet/cors/auth interference
const rawBodyParsers = [express.json(), express.urlencoded({ extended: true })];
app.all('/api/ivr/voice/status', ...rawBodyParsers, handleCallStatus);
app.all('/api/ivr/voice/error', ...rawBodyParsers, handleErrorWebhook);

app.use(helmet({ contentSecurityPolicy: false }));

// Redact sensitive query params (raw card fields, CVV, etc.) from request logs.
// Card data is no longer passed via query string, but this is defense-in-depth
// so a future regression can never leak a PAN/CVV into the access log.
const SENSITIVE_QUERY_KEYS = /^(cc_num|cc_exp|cc_cvv|cc_zip|card_number|cvv)$/i;
morgan.token('url', (req: express.Request) => {
  const original = (req as any).originalUrl || req.url || '';
  const qIdx = original.indexOf('?');
  if (qIdx === -1) return original;
  const path = original.slice(0, qIdx);
  const params = new URLSearchParams(original.slice(qIdx + 1));
  let changed = false;
  for (const key of Array.from(params.keys())) {
    if (SENSITIVE_QUERY_KEYS.test(key)) {
      params.set(key, 'REDACTED');
      changed = true;
    }
  }
  const qs = params.toString();
  return changed ? `${path}?${qs}` : original;
});
app.use(morgan('combined'));
app.use(cors({ origin: config.adminUrl, credentials: true }));

app.use('/api/ivr', express.json(), express.urlencoded({ extended: true }), teltechRouter);

app.use('/api/webhooks', express.json(), webhookRouter);

// Marketing site contact form — POST /api/contact-submissions.
// The marketing site (e.g. www.voicexshop.com) is a separate origin from the API,
// so this route gets its own CORS that allows the public marketing domains.
const contactCors = cors({
  origin: [
    'https://www.voicexshop.com',
    'https://voicexshop.com',
    'https://www.voicexservice.com',
    'https://voicexservice.com',
    config.adminUrl,
  ],
  methods: ['POST', 'OPTIONS'],
});
app.options('/api/contact-submissions', contactCors);
app.use('/api/contact-submissions', contactCors, express.json(), contactRouter);

app.use('/api/admin', express.json(), adminRouter);

// Protected scheduler endpoints (triggered by Supabase pg_cron via pg_net).
app.use('/api/cron', express.json(), cronRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Keep in sync with apps/admin-web/public/voicex.svg
app.get(['/favicon.ico', '/favicon.svg'], (_req, res) => {
  res.type('image/svg+xml').send(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">' +
    '<rect width="32" height="32" rx="8" fill="#4F46E5"/>' +
    '<path d="M8 12L16 20L24 12" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="16" cy="10" r="3" fill="white"/>' +
    '</svg>'
  );
});

if (process.env.VERCEL !== '1') {
  app.listen(config.port, () => {
    console.log(`VoiceX API listening on port ${config.port}`);
  });
  // The in-process worker drains locked subscription runs with time spacing.
  startSubscriptionWorker();
}

export default app;
