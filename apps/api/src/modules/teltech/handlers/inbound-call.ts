import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';
import { dispatchNode } from '../../ivr/graph-dispatcher.js';
import { buildHangup } from '../teltech-builder.js';

export async function handleInboundCall(req: Request, res: Response) {
  const callId = req.body.call_id;
  const callerNumber = req.body.caller_id;

  try {
    const flowVersion = await ivrRuntime.getActiveFlowVersion();

    if (!flowVersion) {
      res.json(
        buildHangup('The system is not yet configured. Please try again later.')
      );
      return;
    }

    await ivrRuntime.createSession(callId, callerNumber, null);

    await dispatchNode(req, res, 'entry', callId, flowVersion.id, {
      call_sid: callId,
      node_key: 'entry',
    });
  } catch (error) {
    console.error('Inbound call error:', error);
    res.json(
      buildHangup('We are experiencing technical difficulties. Please try again later.')
    );
  }
}
