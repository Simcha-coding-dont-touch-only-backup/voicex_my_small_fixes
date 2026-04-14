import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../../config.js';
import { handleInboundCall } from './handlers/inbound-call.js';
import { handleGatherResult } from './handlers/gather-result.js';
import { handlePaymentResult } from './handlers/payment-result.js';
import { handleCallStatus } from './handlers/call-status.js';
import { handleErrorWebhook } from './handlers/error-webhook.js';

function verifyTeltechAuth(req: Request, res: Response, next: NextFunction) {
  const expected = config.teltech.apiAuth;
  if (!expected) {
    console.warn('TELTECH_API_AUTH is not configured — rejecting request');
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  const authorization = req.headers.authorization;
  if (!authorization || authorization !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

export const teltechRouter = Router();

// Fire-and-forget webhooks from TelTech — no api_auth header
teltechRouter.post('/voice/error', handleErrorWebhook);
teltechRouter.post('/voice/status', handleCallStatus);

teltechRouter.use(verifyTeltechAuth);

teltechRouter.post('/voice/inbound', handleInboundCall);
teltechRouter.post('/voice/gather', handleGatherResult);
teltechRouter.post('/voice/payment', handlePaymentResult);
