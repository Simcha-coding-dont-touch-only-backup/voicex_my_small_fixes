import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildGatherFromNode, buildSay, formatCurrency } from '../../teltech/teltech-builder.js';
import { ivrRuntime } from '../runtime.js';
import { formatOrderIdForSpeech } from '@voicex/shared';

function formatEtaDateForSpeech(etaDate: string): string {
  return new Date(`${etaDate}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function getSortedEtaDates(order: any): string[] {
  return [...(order.order_fulfillment_etas || [])]
    .sort((a, b) => {
      const sortDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (sortDiff !== 0) return sortDiff;
      return String(a.eta_date).localeCompare(String(b.eta_date));
    })
    .map((eta) => eta.eta_date)
    .filter(Boolean);
}

function packageLabel(index: number): string {
  return ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'][index] || `Package ${index + 1}`;
}

function formatEtaSpeech(order: any): string {
  const etaDates = getSortedEtaDates(order);
  if (etaDates.length === 0) return '';
  if (etaDates.length === 1) {
    return `Your order is due to arrive on ${formatEtaDateForSpeech(etaDates[0])}`;
  }

  const packageEtas = etaDates.map((etaDate, index) => (
    `${packageLabel(index)} package is due to arrive on ${formatEtaDateForSpeech(etaDate)}`
  ));
  return `This order was shipped as ${etaDates.length} packages. ${packageEtas.join('. ')}`;
}

function parseSessionOrderIds(orderIds: string | undefined): string[] {
  return (orderIds || '')
    .split(',')
    .map((orderId) => orderId.trim())
    .filter(Boolean);
}

registerHandler('orders_list', async (ctx) => {
  const userId = ctx.sessionData.user_id;

  const { data: orders } = await supabaseAdmin
    .from('orders')
    .select('id, status, total_cents, created_at, order_fulfillment_etas(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!orders || orders.length === 0) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'You have no orders. Press star for the Main Menu.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: ctx.node.config.num_digits,
        timeout: ctx.node.config.timeout_seconds || 8,
        finishOnKey: ctx.node.config.finish_on_key,
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' },
      }),
    };
  }

  const lines = orders.map((o, idx) => {
    const speechId = formatOrderIdForSpeech(o.id);
    const date = new Date(o.created_at).toLocaleDateString('en-US');
    const etaSpeech = formatEtaSpeech(o);
    return `Order ${idx + 1}: number ${speechId}, placed on ${date}, status ${o.status}, total ${formatCurrency(o.total_cents)}${etaSpeech ? `. ${etaSpeech}` : ''}`;
  });

  return {
    type: 'actions',
    response: buildGather({
      prompt: `${lines.join('. ')}. To hear details about an order, enter the order number from 1 to ${orders.length}. Press star for Main Menu.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: ctx.node.config.num_digits,
      timeout: ctx.node.config.timeout_seconds || 10,
      finishOnKey: ctx.node.config.finish_on_key,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId, node_key: 'orders_detail',
        order_ids: orders.map((o) => String(o.id)).join(','),
      },
    }),
  };
});

registerHandler('orders_detail', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const orderIds = parseSessionOrderIds(ctx.sessionData.order_ids);

  if (digits === '*') {
    const mainNode = await ivrRuntime.getNodeByKey(ctx.flowVersionId, 'main_menu');
    if (mainNode) {
      return {
        type: 'actions',
        response: buildGatherFromNode(mainNode, { call_sid: ctx.callSid, user_id: userId }),
      };
    }
  }

  if (digits === '0') {
    return {
      type: 'actions',
      response: buildSay('Returning to your orders.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'orders_list' }),
    };
  }

  if (orderIds.length === 0) {
    return {
      type: 'actions',
      response: buildSay('I could not find your recent orders. Returning to your orders list.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'orders_list' }),
    };
  }

  const idx = parseInt(digits || '0', 10) - 1;
  if (idx < 0 || idx >= orderIds.length) {
    return {
      type: 'actions',
      response: buildSay('Invalid selection.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'orders_list' }),
    };
  }

  const orderId = orderIds[idx];

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('*, order_items(*), order_fulfillment_etas(*)')
    .eq('id', orderId)
    .eq('user_id', userId)
    .single();

  if (!order) {
    return {
      type: 'actions',
      response: buildSay('Order not found.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'orders_list' }),
    };
  }

  const itemLines = (order.order_items || []).map(
    (oi: any) => `${oi.product_name}, quantity ${oi.quantity}, at ${formatCurrency(oi.unit_price_cents)} each`
  );

  const speechId = formatOrderIdForSpeech(order.id);
  const etaSpeech = formatEtaSpeech(order);

  return {
    type: 'actions',
    response: buildGather({
      prompt: `Order ${speechId}. Status: ${order.status}. Total: ${formatCurrency(order.total_cents)}.${etaSpeech ? ` ${etaSpeech}.` : ''} Items: ${itemLines.join('. ')}. Press star for Main Menu, or press 0 to go back to the orders list.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: ctx.node.config.num_digits,
      timeout: ctx.node.config.timeout_seconds || 10,
      finishOnKey: ctx.node.config.finish_on_key,
      sessionData: {
        call_sid: ctx.callSid,
        user_id: userId,
        node_key: 'orders_detail',
        order_ids: orderIds.join(','),
      },
    }),
  };
});
