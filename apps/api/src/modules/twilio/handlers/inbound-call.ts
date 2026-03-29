import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';
import { dispatchNode } from '../../ivr/graph-dispatcher.js';
import { buildHangup } from '../twiml-builder.js';

export async function handleInboundCall(req: Request, res: Response) {
  const callSid = req.body.CallSid;
  const callerNumber = req.body.From;

  try {
    const flowVersion = await ivrRuntime.getActiveFlowVersion();

    if (!flowVersion) {
      res.type('text/xml').send(
        buildHangup('The system is not yet configured. Please try again later.')
      );
      return;
    }

    await ivrRuntime.createSession(callSid, callerNumber, null);

    await dispatchNode(req, res, 'entry', callSid, flowVersion.id, {
      call_sid: callSid,
      node_key: 'entry',
    });
  } catch (error) {
    console.error('Inbound call error:', error);
    res.type('text/xml').send(
      buildHangup('We are experiencing technical difficulties. Please try again later.')
    );
  }
}
