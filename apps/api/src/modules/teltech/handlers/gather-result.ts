import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';
import { dispatchNode } from '../../ivr/graph-dispatcher.js';
import { buildHangup } from '../teltech-builder.js';
import { supabaseAdmin } from '../../../lib/supabase.js';

export const callWebhookCounts = new Map<string, { count: number; nodes: string[] }>();

const WEBHOOK_WARN_THRESHOLD = 20;

async function logHighWebhookCount(
  callSid: string,
  nodeKey: string,
  count: number,
  nodeHistory: string[],
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
      error_type: 'high_webhook_count',
      error_detail: `Webhook call #${count} — approaching TelTech loop limit. Node history: ${nodeHistory.slice(-15).join(' → ')}`,
      caller_id: session?.phone_number || null,
      user_id: session?.user_id || null,
      user_name: userName,
      node_key: nodeKey,
      flow_version_id: session?.flow_version_id || null,
      session_data: { webhook_count: count, node_history: nodeHistory },
      raw_payload: { source: 'app_side_detection', current_node: nodeKey, digits: null },
    });
  } catch (err) {
    console.error('Failed to log high webhook count:', err);
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

  let tracker = callWebhookCounts.get(callSid);
  if (!tracker) {
    tracker = { count: 0, nodes: [] };
    callWebhookCounts.set(callSid, tracker);
  }
  tracker.count++;
  tracker.nodes.push(nodeKey);

  try {
    const session = await ivrRuntime.getSession(callSid);
    const flowVersionId = session?.flow_version_id;

    if (tracker.count >= WEBHOOK_WARN_THRESHOLD) {
      await logHighWebhookCount(callSid, nodeKey, tracker.count, tracker.nodes, session);
    }

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
