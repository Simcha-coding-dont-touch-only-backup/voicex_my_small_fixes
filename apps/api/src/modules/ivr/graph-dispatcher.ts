import type { Request, Response } from 'express';
import { ivrRuntime } from './runtime.js';
import { getHandler } from './handler-registry.js';
import { buildMenuFromNode, buildGatherFromNode, buildGather, buildHangup, buildSay } from '../teltech/teltech-builder.js';
import { normalizeInput } from '../teltech/input-normalizer.js';
import type { HandlerContext } from './handler-registry.js';

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
      const ctx: HandlerContext = {
        req,
        res,
        node,
        callSid,
        userId,
        flowVersionId,
        sessionData,
      };

      try {
        const result = await handler(ctx);
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

      // Per-node "ignore keys": swallow these DTMF presses without matching an
      // intent and without re-speaking the (often long) menu prompt. Configure
      // via `config.ignore_keys` (e.g. ["#"]) on a single node so callers who
      // press an ignored key just stay put on the current menu. We re-arm the
      // gather with a near-silent prompt so the provider keeps listening.
      const ignoreKeys: string[] = node.config.ignore_keys ?? [];
      if (digits && ignoreKeys.includes(digits)) {
        (req as any)._suppressStackPush = true;
        res.json(
          buildGatherFromNode(node, { ...sessionData, node_key: nodeKey }, { prompt: ' ' })
        );
        return;
      }

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
      res.json(buildHangup(node.prompt_text || undefined));
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
            { ...sessionData, node_key: nextNode.node_key }
          )
        );
      } else {
        res.json(buildHangup(node.prompt_text || 'Thank you.'));
      }
      return;
    }

    default: {
      res.json(buildHangup('System error.'));
    }
  }
}
