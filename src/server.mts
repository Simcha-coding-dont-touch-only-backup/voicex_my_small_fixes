import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../apps/api/src/config.js';
import { teltechRouter } from '../apps/api/src/modules/teltech/routes.js';
import { adminRouter } from '../apps/api/src/modules/admin/routes.js';
import { webhookRouter } from '../apps/api/src/modules/orders/webhook-routes.js';
import '../apps/api/src/modules/ivr/init-handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminDist = path.join(__dirname, '..', 'apps', 'admin-web', 'dist');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));
app.use(cors({ origin: config.adminUrl, credentials: true }));

app.use('/api/ivr', express.json(), teltechRouter);

app.use('/api/webhooks', express.json(), webhookRouter);

app.use('/api/admin', express.json(), adminRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(express.static(adminDist));

app.get('*', (_req, res) => {
  res.sendFile(path.join(adminDist, 'index.html'));
});

export default app;
