import type { Request, Response } from 'express';
import { normalizeInput } from '../../twilio/speech-normalizer.js';
import { buildGather, buildSay } from '../../twilio/twiml-builder.js';
import type { IvrIntent } from '@voicex/shared';

const MAIN_MENU_INTENTS: IvrIntent[] = [
  {
    name: 'catalog',
    dtmf_key: '1',
    speech_phrases: ['catalog', 'one', 'shopping', 'buy products', 'browse', 'products', 'shop'],
    target_node_key: 'catalog_input',
  },
  {
    name: 'cart',
    dtmf_key: '2',
    speech_phrases: ['cart', 'two', 'my cart', 'view cart', 'shopping cart'],
    target_node_key: 'cart_menu',
  },
  {
    name: 'orders',
    dtmf_key: '3',
    speech_phrases: ['orders', 'three', 'order status', 'my orders', 'track order'],
    target_node_key: 'orders_list',
  },
  {
    name: 'returns',
    dtmf_key: '4',
    speech_phrases: ['returns', 'four', 'return'],
    target_node_key: 'main_menu',
  },
];

export async function handleMainMenu(req: Request, res: Response) {
  const userId = req.query.user_id as string;
  const callSid = req.query.call_sid as string;
  const digits = req.body.Digits;
  const speechResult = req.body.SpeechResult;
  const confidence = req.body.Confidence;

  const input = normalizeInput(digits, speechResult, confidence, MAIN_MENU_INTENTS);

  if (!input.matchedIntent) {
    res.type('text/xml').send(
      buildGather({
        prompt: 'I didn\'t understand. Press 1 for Catalog, 2 for Cart, 3 for Orders.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 8,
        hints: ['catalog', 'cart', 'orders'],
        sessionData: { call_sid: callSid, user_id: userId, step: 'main_menu' },
      })
    );
    return;
  }

  const targetStep = MAIN_MENU_INTENTS.find(
    (i) => i.name === input.matchedIntent
  )?.target_node_key;

  switch (targetStep) {
    case 'catalog_input':
      res.type('text/xml').send(
        buildGather({
          prompt: 'Please enter the catalog number for the product you would like to look up.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf',
          timeout: 10,
          finishOnKey: '#',
          sessionData: { call_sid: callSid, user_id: userId, step: 'catalog_input' },
        })
      );
      break;

    case 'cart_menu':
      res.type('text/xml').send(
        buildSay(
          'Loading your cart.',
          `/api/twilio/voice/gather?step=cart_menu&user_id=${userId}&call_sid=${callSid}`
        )
      );
      break;

    case 'orders_list':
      res.type('text/xml').send(
        buildSay(
          'Loading your orders.',
          `/api/twilio/voice/gather?step=orders_list&user_id=${userId}&call_sid=${callSid}`
        )
      );
      break;

    case 'main_menu':
      res.type('text/xml').send(
        buildGather({
          prompt: 'Returns are not yet available. Press 1 for Catalog, 2 for Cart, 3 for Orders.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf speech',
          timeout: 8,
          hints: ['catalog', 'cart', 'orders'],
          sessionData: { call_sid: callSid, user_id: userId, step: 'main_menu' },
        })
      );
      break;

    default:
      res.type('text/xml').send(
        buildGather({
          prompt: 'Press 1 for Catalog, 2 for Cart, 3 for Orders.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf speech',
          timeout: 8,
          hints: ['catalog', 'cart', 'orders'],
          sessionData: { call_sid: callSid, user_id: userId, step: 'main_menu' },
        })
      );
  }
}
