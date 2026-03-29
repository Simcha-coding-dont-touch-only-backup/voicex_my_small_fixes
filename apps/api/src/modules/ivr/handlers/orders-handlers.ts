import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildSay, formatCurrency } from '../../twilio/twiml-builder.js';
import { ivrRuntime } from '../runtime.js';

registerHandler('orders_list', async (ctx) => {
  const userId = ctx.sessionData.user_id;

  const { data: orders } = await supabaseAdmin
    .from('orders')
    .select('id, status, total_cents, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!orders || orders.length === 0) {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'You have no orders. Press star for the Main Menu.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 8,
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' },
      }),
    };
  }

  const lines = orders.map((o, idx) => {
    const shortId = o.id.slice(-6).toUpperCase();
    const date = new Date(o.created_at).toLocaleDateString('en-US');
    return `Order ${idx + 1}: number ${shortId}, placed on ${date}, status ${o.status}, total ${formatCurrency(o.total_cents)}`;
  });

  return {
    type: 'twiml',
    twiml: buildGather({
      prompt: `${lines.join('. ')}. To hear details about an order, enter the order number from 1 to ${orders.length}. Press star for Main Menu.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
      numDigits: 1,
      timeout: 10,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId, node_key: 'orders_detail',
        order_ids: orders.map((o) => o.id).join(','),
      },
    }),
  };
});

registerHandler('orders_detail', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.Digits;
  const orderIds = (ctx.sessionData.order_ids || '').split(',');

  if (digits === '*') {
    const mainNode = await ivrRuntime.getNodeByKey(ctx.flowVersionId, 'main_menu');
    if (mainNode) {
      const intents = mainNode.config.intents || [];
      const hints = intents.flatMap((i: any) => i.speech_phrases);
      return {
        type: 'twiml',
        twiml: buildGather({
          prompt: mainNode.prompt_text || 'Main Menu.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf speech',
          timeout: 8,
          hints,
          sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' },
        }),
      };
    }
  }

  const idx = parseInt(digits || '0', 10) - 1;
  if (idx < 0 || idx >= orderIds.length) {
    return {
      type: 'twiml',
      twiml: buildSay('Invalid selection.', `/api/twilio/voice/gather?node_key=orders_list&user_id=${userId}&call_sid=${ctx.callSid}`),
    };
  }

  const orderId = orderIds[idx];

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', orderId)
    .single();

  if (!order) {
    return {
      type: 'twiml',
      twiml: buildSay('Order not found.', `/api/twilio/voice/gather?node_key=orders_list&user_id=${userId}&call_sid=${ctx.callSid}`),
    };
  }

  const itemLines = (order.order_items || []).map(
    (oi: any) => `${oi.product_name}, quantity ${oi.quantity}, at ${formatCurrency(oi.unit_price_cents)} each`
  );

  const shortId = order.id.slice(-6).toUpperCase();

  return {
    type: 'twiml',
    twiml: buildGather({
      prompt: `Order ${shortId}. Status: ${order.status}. Total: ${formatCurrency(order.total_cents)}. Items: ${itemLines.join('. ')}. Press star for Main Menu, or press 0 to go back to the orders list.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
      numDigits: 1,
      timeout: 10,
      sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: 'orders_list' },
    }),
  };
});
