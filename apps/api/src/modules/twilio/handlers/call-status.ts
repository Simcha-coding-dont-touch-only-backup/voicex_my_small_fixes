import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';

export async function handleCallStatus(req: Request, res: Response) {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;

  if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer') {
    try {
      await ivrRuntime.endSession(callSid);
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  }

  res.sendStatus(200);
}
