import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';
import { dispatchNode } from '../../ivr/graph-dispatcher.js';
import { buildHangup } from '../teltech-builder.js';
import { supabaseAdmin } from '../../../lib/supabase.js';

function countActions(response: any): number {
  if (!response?.actions) return 0;
  let count = 0;
  for (const action of response.actions) {
    count++;
    if (action.action === 'gather' || action.action === 'collect') {
      if (action.prompt) count++;
      const tries = action.tries ?? action.retry ?? 1;
      if (tries > 1) count += (tries - 1);
    }
  }
  return count;
}

function getResponseType(response: any): string {
  if (!response?.actions?.length) return 'empty';
  const types = response.actions.map((a: any) => a.action);
  if (types.includes('gather')) return 'gather';
  if (types.includes('collect')) return 'collect';
  if (types.includes('hangup')) return 'hangup';
  if (types.includes('redirect')) return 'say+redirect';
  if (types.includes('say')) return 'say';
  return types.join('+');
}

async function logWebhookStep(
  callSid: string,
  nodeKey: string,
  digits: string | null,
  actionCount: number,
  responseType: string,
  recursionDepth: number,
  session: any
) {
  try {
    let userName: string | null = null;
    if (session?.user_id) {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('name')
        .eq('id', session.user_id)
        .single();
      userName = user?.name || null;
    }

    await supabaseAdmin.from('ivr_error_logs').insert({
      call_sid: callSid,
      error_type: 'call_step',
      error_detail: `${nodeKey}${digits ? ` (digits: ${digits})` : ''}`,
      caller_id: session?.phone_number || null,
      user_id: session?.user_id || null,
      user_name: userName,
      node_key: nodeKey,
      flow_version_id: session?.flow_version_id || null,
      session_data: {
        digits,
        action_count: actionCount,
        response_type: responseType,
        recursion_depth: recursionDepth,
      },
      raw_payload: { node: nodeKey, digits },
    });
  } catch (err) {
    console.error('Failed to log webhook step:', err);
  }
}

export async function handleGatherResult(req: Request, res: Response) {
  const nodeKey = req.query.node_key as string;
  const callSid = req.query.call_sid as string;

  if (!nodeKey || !callSid) {
    console.error('Missing node_key or call_sid in gather result');
    res.json(buildHangup('An error occurred. Please call back.'));
    return;
  }

  const origJson = res.json.bind(res);
  let captured: any = null;
  res.json = (body: any) => {
    captured = body;
    return origJson(body);
  };

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
    } else {
      await ivrRuntime.updateSession(callSid, { current_node_key: nodeKey });
      await dispatchNode(req, res, nodeKey, callSid, flowVersionId, extractSessionData(req));
    }

    const actionCount = countActions(captured);
    const responseType = getResponseType(captured);
    const recursionDepth = (req as any)._dispatchDepth || 0;

    await logWebhookStep(callSid, nodeKey, req.body.digits || null, actionCount, responseType, recursionDepth, session);
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
