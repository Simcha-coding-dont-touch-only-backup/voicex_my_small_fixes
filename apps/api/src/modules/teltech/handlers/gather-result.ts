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

/**
 * Nodes where the caller's keypresses ARE raw card data (PAN / expiry / CVV /
 * billing ZIP). The dialed digits for these steps must never be written to the
 * step log. Covers both the one-time checkout and the subscription card flows.
 */
const SENSITIVE_INPUT_NODE_KEYS = new Set([
  'checkout_card_number',
  'checkout_card_exp',
  'checkout_card_cvv',
  'checkout_card_zip',
  'subscriptions_card_number',
  'subscriptions_card_exp',
  'subscriptions_card_cvv',
  'subscriptions_card_confirm',
]);

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

    // Redact dialed digits on card-entry nodes so the raw PAN / CVV / expiry
    // never lands in ivr_error_logs.
    const safeDigits =
      digits && SENSITIVE_INPUT_NODE_KEYS.has(nodeKey) ? '[REDACTED]' : digits;

    await supabaseAdmin.from('ivr_error_logs').insert({
      call_sid: callSid,
      error_type: 'call_step',
      error_detail: `${nodeKey}${safeDigits ? ` (digits: ${safeDigits})` : ''}`,
      caller_id: session?.phone_number || null,
      user_id: session?.user_id || null,
      user_name: userName,
      node_key: nodeKey,
      flow_version_id: session?.flow_version_id || null,
      session_data: {
        digits: safeDigits,
        action_count: actionCount,
        response_type: responseType,
        recursion_depth: recursionDepth,
      },
      raw_payload: { node: nodeKey, digits: safeDigits },
    });
  } catch (err) {
    console.error('Failed to log webhook step:', err);
  }
}

const NON_INTERACTIVE_NODE_TYPES = new Set(['entry', 'hangup']);

function extractNodeKeyFromActionUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('node_key');
  } catch {
    const match = url.match(/[?&]node_key=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

/**
 * The node the caller is left *parked* at — i.e. the gather/collect whose
 * action URL their next keypress will hit. Pure `redirect` hops (the
 * `say` + `redirect` announce pattern) are intentionally ignored: they are
 * transient pass-throughs, not menus the caller can act on, so they must not
 * become `*`-back targets.
 */
function extractGatheredNodeKey(response: any): string | null {
  if (!response?.actions) return null;
  for (const action of response.actions) {
    if (action.action === 'gather' || action.action === 'collect') {
      const url = action.action_url || action.url;
      const key = extractNodeKeyFromActionUrl(url);
      if (key) return key;
    }
  }
  return null;
}

export async function handleGatherResult(req: Request, res: Response) {
  let nodeKey = req.query.node_key as string;
  const callSid = req.query.call_sid as string;

  if (!nodeKey || !callSid) {
    console.error('Missing node_key or call_sid in gather result');
    res.json(buildHangup('An error occurred. Please call back.'));
    return;
  }

  // Buffer the response instead of flushing it immediately. On serverless
  // platforms the function can be frozen/suspended right after the HTTP
  // response is sent, which kills any in-flight awaited work that runs *after*
  // res.json() — including the menu-stack bookkeeping below. By capturing the
  // body here and only sending it once all bookkeeping has completed, the
  // stack writes are guaranteed to finish before the response flushes.
  const origJson = res.json.bind(res);
  let captured: any = null;
  let sent = false;
  res.json = (body: any) => {
    captured = body;
    return res;
  };
  const flush = () => {
    if (sent) return;
    sent = true;
    res.json = origJson;
    origJson(captured ?? buildHangup('An error occurred. Please call back.'));
  };

  try {
    const session = await ivrRuntime.getSession(callSid);
    const flowVersionId = session?.flow_version_id;

    if (!flowVersionId) {
      const activeVersion = await ivrRuntime.getActiveFlowVersion();
      if (!activeVersion) {
        res.json(buildHangup('System is not configured. Please contact support.'));
        flush();
        return;
      }
      await dispatchNode(req, res, nodeKey, callSid, activeVersion.id, extractSessionData(req));
      flush();
      return;
    }

    let didPop = false;
    const incomingDigits = typeof req.body?.digits === 'string' ? req.body.digits : null;

    // Treat `*` as a universal "back" request whenever it appears at the
    // start or end of the captured digit buffer. This covers:
    //   - caller pressed `*` alone               → digits === '*'
    //   - caller pressed `*` then `#`            → digits === '*'
    //   - caller started typing then bailed      → digits ends with `*`
    //   - caller pressed `*` first then typed    → digits starts with `*`
    // A `*` in the middle (e.g. "1*2") is almost certainly a misfire and is
    // left for the downstream handler to reject as invalid input.
    const isBackRequest =
      incomingDigits !== null &&
      incomingDigits.length > 0 &&
      (incomingDigits.startsWith('*') || incomingDigits.endsWith('*'));

    if (isBackRequest) {
      const currentNode = await ivrRuntime.getNodeByKey(flowVersionId, nodeKey);
      const isInteractive =
        currentNode && !NON_INTERACTIVE_NODE_TYPES.has(currentNode.node_type);

      if (isInteractive) {
        req.body.digits = undefined;
        const prevNodeKey = await ivrRuntime.popMenuStack(callSid);
        if (prevNodeKey) {
          nodeKey = prevNodeKey;
          didPop = true;
        }
      }
    }

    await ivrRuntime.updateSession(callSid, { current_node_key: nodeKey });

    const sessionData = extractSessionData(req);
    if (didPop) {
      sessionData.node_key = nodeKey;
    }

    await dispatchNode(req, res, nodeKey, callSid, flowVersionId, sessionData);

    const suppressPush = (req as any)._suppressStackPush === true;

    // Track the menu the caller is now parked at (the gather/collect their next
    // keypress routes to). `recordMenuVisit` pushes the menu they're leaving
    // onto the back stack whenever they move to a genuinely new menu, so `*`
    // returns to the previous menu the caller actually heard — not to a
    // transient selection/announce node, and not to a re-render of the current
    // menu. `*`-back itself (`didPop`) already updated the pointer in popMenuStack.
    if (!didPop && !suppressPush) {
      const parkedNodeKey = extractGatheredNodeKey(captured);
      if (parkedNodeKey) {
        const parkedNode = await ivrRuntime.getNodeByKey(flowVersionId, parkedNodeKey);
        if (!parkedNode || !NON_INTERACTIVE_NODE_TYPES.has(parkedNode.node_type)) {
          await ivrRuntime.recordMenuVisit(callSid, parkedNodeKey);
        }
      }
    }

    // Bookkeeping is done — now it's safe to flush the buffered response.
    flush();

    const actionCount = countActions(captured);
    const responseType = getResponseType(captured);
    const recursionDepth = (req as any)._dispatchDepth || 0;

    await logWebhookStep(callSid, nodeKey, incomingDigits, actionCount, responseType, recursionDepth, session);
  } catch (error) {
    console.error(`Error in gather result for node ${nodeKey}:`, error);
    captured = buildHangup('We encountered an error. Please try again later.');
    flush();
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
