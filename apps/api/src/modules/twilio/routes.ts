import { Router } from 'express';
import { handleInboundCall } from './handlers/inbound-call.js';
import { handleGatherResult } from './handlers/gather-result.js';
import { handlePaymentResult } from './handlers/payment-result.js';
import { handleCallStatus } from './handlers/call-status.js';

export const twilioRouter = Router();

twilioRouter.post('/voice/inbound', handleInboundCall);
twilioRouter.post('/voice/gather', handleGatherResult);
twilioRouter.post('/voice/payment', handlePaymentResult);
twilioRouter.post('/voice/status', handleCallStatus);
