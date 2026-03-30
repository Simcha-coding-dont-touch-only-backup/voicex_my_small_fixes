import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';
import { dispatchNode } from '../../ivr/graph-dispatcher.js';
import { buildHangup } from '../teltech-builder.js';

export async function handleGatherResult(req: Request, res: Response) {
  const nodeKey = req.query.node_key as string;
  const callSid = req.query.call_sid as string;

  if (!nodeKey || !callSid) {
    console.error('Missing node_key or call_sid in gather result');
    res.json(buildHangup('An error occurred. Please call back.'));
    return;
  }

  try {
    const session = await ivrRuntime.getSession(callSid);
    const flowVersionId = session?.flow_version_id;

    if (!flowVersionId) {
      const activeVersion = await ivrRuntime.getActiveFlowVersion();
      if (!activeVersion) {
        res.json(buildHangup('System is not configured. Please contact support.'));
        return;
      }
      await dispatchNode(req, res, nodeKey, callSid, activeVersion.id, extractSessionData(req));
      return;
    }

    await ivrRuntime.updateSession(callSid, { current_node_key: nodeKey });
    await dispatchNode(req, res, nodeKey, callSid, flowVersionId, extractSessionData(req));
  } catch (error) {
    console.error(`Error in gather result for node ${nodeKey}:`, error);
    res.json(buildHangup('We encountered an error. Please try again later.'));
  }
}

function extractSessionData(req: Request): Record<string, string> {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') {
      data[key] = value;
    }
  }
  return data;
}
