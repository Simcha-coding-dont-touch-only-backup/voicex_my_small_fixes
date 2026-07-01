import type { Request, Response } from 'express';
import { ivrRuntime } from './runtime.js';
import { getHandler } from './handler-registry.js';
import { buildMenuFromNode, buildGather, buildHangup, buildSay, resolveNodeTimeout } from '../teltech/teltech-builder.js';
import { normalizeInput } from '../teltech/input-normalizer.js';
import type { HandlerContext } from './handler-registry.js';
import type { TeltechResponse } from '../../lib/teltech.js';

function extractNodeKeyFromActionUrl(actionUrl: string | undefined): string | null {
  if (!actionUrl) return null;
  try {
    return new URL(actionUrl).searchParams.get('node_key');
  } catch {
    const match = actionUrl.match(/[?&]node_key=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

/**
 * Make the IVR flow editor the source of truth for gather timeouts. Handlers
 * build gathers with their own per-prompt fallback timeout, but if the outgoing
 * node (the one the caller's next keypress routes to) has an editor-configured
 * `timeout_seconds`, that value wins. This is applied centrally here so every
 * handler-driven gather honors the editor without each call site having to read
 * the node config.
 */
async function applyNodeTimeoutOverrides(
  response: TeltechResponse,
  flowVersionId: string,
): Promise<void> {
  if (!response?.actions) return;
  for (const action of response.actions) {
    if (action.action !== 'gather') continue;
    const outgoingNodeKey = extractNodeKeyFromActionUrl(action.action_url);
    if (!outgoingNodeKey) continue;
    const node = await ivrRuntime.getNodeByKey(flowVersionId, outgoingNodeKey);
    const configured = node?.config?.timeout_seconds;
    if (typeof configured === 'number' && configured > 0) {
      action.timeout = resolveNodeTimeout(node, configured) * 1000;
    }
  }
}

export async function dispatchNode(
  req: Request,
  res: Response,
  nodeKey: string,
  callSid: string,
  flowVersionId: string,
  sessionData: Record<string, string>
): Promise<void> {
  const depth = ((req as any)._dispatchDepth || 0) + 1;
  (req as any)._dispatchDepth = depth;

  const node = await ivrRuntime.getNodeByKey(flowVersionId, nodeKey);

  if (!node) {
    console.error(`Node not found: ${nodeKey} in flow version ${flowVersionId}`);
    res.json(buildHangup('An error occurred. Please call back.'));
    return;
  }

  const userId = sessionData.user_id || null;

  if (node.handler_name) {
    const handler = getHandler(node.handler_name);
    if (handler) {
      const secureData = await ivrRuntime.getSecureData(callSid);
      const ctx: HandlerContext = {
        req,
        res,
        node,
        callSid,
        userId,
        flowVersionId,
        sessionData,
        secureData,
        setSecureData: (partial) => ivrRuntime.setSecureData(callSid, partial),
        clearSecureData: () => ivrRuntime.clearSecureData(callSid),
      };

      try {
        const result = await handler(ctx);
        await applyNodeTimeoutOverrides(result.response, flowVersionId);
        res.json(result.response);
        return;
      } catch (error) {
        console.error(`Handler error in ${node.handler_name}:`, error);
        res.json(buildHangup('We encountered an error. Please try again later.'));
        return;
      }
    }

    console.warn(`Handler not found: ${node.handler_name} for node ${nodeKey}`);
  }

  switch (node.node_type) {
    case 'menu': {
      const intents = node.config.intents || [];
      const digits = req.body.digits;

      if (digits) {
        const input = normalizeInput(digits, intents);
        if (input.matchedIntent) {
          const targetNodeKey = intents.find((i: any) => i.name === input.matchedIntent)?.target_node_key;
          if (targetNodeKey) {
            const targetNode = await ivrRuntime.getNodeByKey(flowVersionId, targetNodeKey);
            if (targetNode) {
              if (targetNode.handler_name) {
                req.body.digits = undefined;
                return dispatchNode(req, res, targetNodeKey, callSid, flowVersionId, {
                  ...sessionData,
                  node_key: targetNodeKey,
                });
              }

              if (targetNode.node_type === 'action') {
                res.json(
                  buildSay(
                    targetNode.prompt_text || 'Processing.',
                    '/api/ivr/voice/gather',
                    { ...sessionData, node_key: targetNodeKey }
                  )
                );
                return;
              }

              res.json(
                buildGather({
                  prompt: targetNode.prompt_text || 'Please continue.',
                  actionPath: '/api/ivr/voice/gather',
                  numDigits: targetNode.config.num_digits,
                  timeout: targetNode.config.timeout_seconds || 8,
                  finishOnKey: targetNode.config.finish_on_key,
                  sessionData: { ...sessionData, node_key: targetNodeKey },
                })
              );
              return;
            }
          }
        }
      }

      res.json(buildMenuFromNode(node, { ...sessionData, node_key: nodeKey }));
      return;
    }

    case 'hangup': {
      res.json(buildHangup(node.prompt_text || undefined, node.config.prompt_audio_url));
      return;
    }

    case 'input': {
      res.json(
        buildGather({
          prompt: node.prompt_text || 'Please provide input.',
          actionPath: '/api/ivr/voice/gather',
          numDigits: node.config.num_digits,
          timeout: node.config.timeout_seconds || 10,
          finishOnKey: node.config.finish_on_key,
          promptAudioUrl: node.config.prompt_audio_url,
          sessionData: { ...sessionData, node_key: nodeKey },
        })
      );
      return;
    }

    case 'action': {
      const nextNode = await ivrRuntime.resolveNextNode(flowVersionId, node.id, null);
      if (nextNode) {
        res.json(
          buildSay(
            node.prompt_text || 'Processing.',
            '/api/ivr/voice/gather',
            { ...sessionData, node_key: nextNode.node_key },
            node.config.prompt_audio_url,
          )
        );
      } else {
        res.json(buildHangup(node.prompt_text || 'Thank you.', node.config.prompt_audio_url));
      }
      return;
    }

    default: {
      res.json(buildHangup('System error.'));
    }
  }
}
