import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from '../apps/api/src/config.js';
import { twilioRouter } from '../apps/api/src/modules/twilio/routes.js';
import { adminRouter } from '../apps/api/src/modules/admin/routes.js';
import { webhookRouter } from '../apps/api/src/modules/orders/webhook-routes.js';

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

export default app;
