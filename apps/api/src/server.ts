import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { twilioRouter } from './modules/twilio/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { webhookRouter } from './modules/orders/webhook-routes.js';

const app = express();

app.use(helmet());
app.use(morgan('combined'));
app.use(cors({ origin: config.adminUrl, credentials: true }));

app.use('/api/twilio', express.urlencoded({ extended: false }), twilioRouter);

app.use('/api/webhooks', express.json(), webhookRouter);

app.use('/api/admin', express.json(), adminRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

if (process.env.VERCEL !== '1') {
  app.listen(config.port, () => {
    console.log(`VoiceX API listening on port ${config.port}`);
  });
}

export default app;
