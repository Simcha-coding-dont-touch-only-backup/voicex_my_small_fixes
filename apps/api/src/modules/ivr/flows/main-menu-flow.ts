import type { Request, Response } from 'express';
import { normalizeInput } from '../../teltech/input-normalizer.js';
import { buildGather, buildSay } from '../../teltech/teltech-builder.js';
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
  const digits = req.body.digits;

  const input = normalizeInput(digits, MAIN_MENU_INTENTS);

  if (!input.matchedIntent) {
    res.json(
      buildGather({
        prompt: 'I didn\'t understand. Press 1 for Catalog, 2 for Cart, 3 for Orders.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 8,
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
      res.json(
        buildGather({
          prompt: 'Please enter the catalog number for the product you would like to look up.',
          actionPath: '/api/ivr/voice/gather',
          timeout: 10,
          finishOnKey: '#',
          sessionData: { call_sid: callSid, user_id: userId, step: 'catalog_input' },
        })
      );
      break;

    case 'cart_menu':
      res.json(
        buildSay(
          'Loading your cart.',
          '/api/ivr/voice/gather',
          { step: 'cart_menu', user_id: userId, call_sid: callSid }
        )
      );
      break;

    case 'orders_list':
      res.json(
        buildSay(
          'Loading your orders.',
          '/api/ivr/voice/gather',
          { step: 'orders_list', user_id: userId, call_sid: callSid }
        )
      );
      break;

    case 'main_menu':
      res.json(
        buildGather({
          prompt: 'Returns are not yet available. Press 1 for Catalog, 2 for Cart, 3 for Orders.',
          actionPath: '/api/ivr/voice/gather',
          timeout: 8,
          sessionData: { call_sid: callSid, user_id: userId, step: 'main_menu' },
        })
      );
      break;

    default:
      res.json(
        buildGather({
          prompt: 'Press 1 for Catalog, 2 for Cart, 3 for Orders.',
          actionPath: '/api/ivr/voice/gather',
          timeout: 8,
          sessionData: { call_sid: callSid, user_id: userId, step: 'main_menu' },
        })
      );
  }
}
