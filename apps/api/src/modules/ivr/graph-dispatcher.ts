import type { Request, Response } from 'express';
import { ivrRuntime } from './runtime.js';
import { getHandler } from './handler-registry.js';
import { buildMenuFromNode, buildGather, buildHangup, buildSay } from '../twilio/twiml-builder.js';
import { normalizeInput } from '../twilio/speech-normalizer.js';
import type { HandlerContext } from './handler-registry.js';

export async function dispatchNode(
  req: Request,
  res: Response,
  nodeKey: string,
  callSid: string,
  flowVersionId: string,
  sessionData: Record<string, string>
): Promise<void> {
  const node = await ivrRuntime.getNodeByKey(flowVersionId, nodeKey);

  if (!node) {
    console.error(`Node not found: ${nodeKey} in flow version ${flowVersionId}`);
    res.type('text/xml').send(buildHangup('An error occurred. Please call back.'));
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
        res.type('text/xml').send(result.twiml);
        return;
      } catch (error) {
        console.error(`Handler error in ${node.handler_name}:`, error);
        res.type('text/xml').send(buildHangup('We encountered an error. Please try again later.'));
        return;
      }
    }

    console.warn(`Handler not found: ${node.handler_name} for node ${nodeKey}`);
  }

  switch (node.node_type) {
    case 'menu': {
      const intents = node.config.intents || [];
      const digits = req.body.Digits;
      const speechResult = req.body.SpeechResult;
      const confidence = req.body.Confidence;

      if (digits || speechResult) {
        const input = normalizeInput(digits, speechResult, confidence, intents);
        if (input.matchedIntent) {
          const targetNodeKey = intents.find((i: any) => i.name === input.matchedIntent)?.target_node_key;
          if (targetNodeKey) {
            const targetNode = await ivrRuntime.getNodeByKey(flowVersionId, targetNodeKey);
            if (targetNode) {
              if (targetNode.handler_name) {
                return dispatchNode(req, res, targetNodeKey, callSid, flowVersionId, {
                  ...sessionData,
                  node_key: targetNodeKey,
                });
              }

              const targetIntents = targetNode.config.intents || [];
              const hints = targetIntents.flatMap((i: any) => i.speech_phrases);

              res.type('text/xml').send(
                buildGather({
                  prompt: targetNode.prompt_text || 'Please continue.',
                  actionPath: '/api/twilio/voice/gather',
                  inputType: (targetNode.config.input_type as any)?.replace('_', ' ') || 'dtmf speech',
                  numDigits: targetNode.config.num_digits,
                  timeout: targetNode.config.timeout_seconds || 8,
                  finishOnKey: targetNode.config.finish_on_key,
                  hints: hints.length > 0 ? hints : undefined,
                  sessionData: { ...sessionData, node_key: targetNodeKey },
                })
              );
              return;
            }
          }
        }
      }

      res.type('text/xml').send(buildMenuFromNode(node, { ...sessionData, node_key: nodeKey }));
      return;
    }

    case 'hangup': {
      res.type('text/xml').send(buildHangup(node.prompt_text || undefined));
      return;
    }

    case 'input': {
      res.type('text/xml').send(
        buildGather({
          prompt: node.prompt_text || 'Please provide input.',
          actionPath: '/api/twilio/voice/gather',
          inputType: (node.config.input_type as any)?.replace('_', ' ') || 'dtmf',
          numDigits: node.config.num_digits,
          timeout: node.config.timeout_seconds || 10,
          finishOnKey: node.config.finish_on_key,
          hints: node.config.speech_hints,
          sessionData: { ...sessionData, node_key: nodeKey },
        })
      );
      return;
    }

    case 'action': {
      const nextNode = await ivrRuntime.resolveNextNode(flowVersionId, node.id, null);
      if (nextNode) {
        res.type('text/xml').send(
          buildSay(
            node.prompt_text || 'Processing.',
            `/api/twilio/voice/gather?node_key=${nextNode.node_key}&user_id=${userId}&call_sid=${callSid}`
          )
        );
      } else {
        res.type('text/xml').send(buildHangup(node.prompt_text || 'Thank you.'));
      }
      return;
    }

    default: {
      res.type('text/xml').send(buildHangup('System error.'));
    }
  }
}
