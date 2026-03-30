import { buildGather } from '../../teltech/teltech-builder.js';

export function buildMainMenuResponse(callSid: string, userId: string) {
  return buildGather({
    prompt: 'Main Menu. Press 1 or say Catalog to browse products. Press 2 or say Cart to view your cart. Press 3 or say Orders to check order status.',
    actionPath: '/api/ivr/voice/gather',
    timeout: 8,
    sessionData: { call_sid: callSid, user_id: userId, step: 'main_menu' },
  });
}
