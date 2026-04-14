import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';
import { dispatchNode } from '../../ivr/graph-dispatcher.js';
import { buildHangup } from '../teltech-builder.js';
import { supabaseAdmin } from '../../../lib/supabase.js';

interface CallTracker {
  count: number;
  steps: { node: string; digits: string | null; time: string }[];
  startedAt: Date;
  userId: string | null;
  userName: string | null;
  callerPhone: string | null;
  flowVersionId: string | null;
  flushed: boolean;
  flushTimer: ReturnType<typeof setTimeout>;
}

export const callTrackers = new Map<string, CallTracker>();

const FLUSH_TIMEOUT_MS = 2 * 60 * 1000;

export async function flushCallLog(callSid: string, reason: 'hangup' | 'timeout') {
  const tracker = callTrackers.get(callSid);
  if (!tracker || tracker.flushed) return;
  tracker.flushed = true;
  clearTimeout(tracker.flushTimer);
  callTrackers.delete(callSid);

  const endedAt = new Date();
  const durationSec = Math.round((endedAt.getTime() - tracker.startedAt.getTime()) / 1000);
  const lastStep = tracker.steps[tracker.steps.length - 1];

  try {
    await supabaseAdmin.from('ivr_error_logs').insert({
      call_sid: callSid,
      error_type: 'call_trace',
      error_detail: `${tracker.count} webhooks, ${durationSec}s, ended by ${reason}. Last node: ${lastStep?.node || 'unknown'}`,
      caller_id: tracker.callerPhone,
      user_id: tracker.userId,
      user_name: tracker.userName,
      node_key: lastStep?.node || null,
      flow_version_id: tracker.flowVersionId,
      session_data: {
        webhook_count: tracker.count,
        duration_seconds: durationSec,
        started_at: tracker.startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        end_reason: reason,
        steps: tracker.steps,
      },
      raw_payload: {
        source: 'call_trace',
        node_history: tracker.steps.map((s) => s.node),
      },
    });
  } catch (err) {
    console.error('Failed to flush call log:', err);
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

  let tracker = callTrackers.get(callSid);
  if (!tracker) {
    tracker = {
      count: 0,
      steps: [],
      startedAt: new Date(),
      userId: null,
      userName: null,
      callerPhone: null,
      flowVersionId: null,
      flushed: false,
      flushTimer: setTimeout(() => flushCallLog(callSid, 'timeout'), FLUSH_TIMEOUT_MS),
    };
    callTrackers.set(callSid, tracker);
  }
  tracker.count++;
  tracker.steps.push({
    node: nodeKey,
    digits: req.body.digits || null,
    time: new Date().toISOString(),
  });

  try {
    const session = await ivrRuntime.getSession(callSid);
    const flowVersionId = session?.flow_version_id;

    if (session && !tracker.userId) {
      tracker.userId = session.user_id || null;
      tracker.callerPhone = session.phone_number || null;
      tracker.flowVersionId = session.flow_version_id || null;
      if (session.user_id) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('name')
          .eq('id', session.user_id)
          .single();
        tracker.userName = user?.name || null;
      }
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
