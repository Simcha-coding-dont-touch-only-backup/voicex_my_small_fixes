import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';
import { callWebhookCounts } from './gather-result.js';

export async function handleCallStatus(req: Request, res: Response) {
  const callId = req.body.call_id;
  const event = req.body.event;

  if (event === 'hangup' && callId) {
    try {
      await ivrRuntime.endSession(callId);
    } catch (err) {
      console.error('Failed to end session:', err);
    }
    callWebhookCounts.delete(callId);
  }

  res.sendStatus(200);
}