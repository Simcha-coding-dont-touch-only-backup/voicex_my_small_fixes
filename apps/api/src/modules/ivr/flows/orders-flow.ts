import type { Request, Response } from 'express';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildGather, buildSay, formatCurrency } from '../../twilio/twiml-builder.js';
import { buildMainMenuTwiml } from './pin-flow.js';

export async function handleOrdersFlow(req: Request, res: Response) {
  const step = req.query.step as string;
  const userId = req.query.user_id as string;
  const callSid = req.query.call_sid as string;

  switch (step) {
    case 'orders_list':
      return handleOrdersList(req, res, userId, callSid);
    case 'orders_detail':
      return handleOrderDetail(req, res, userId, callSid);
  }
}

async function handleOrdersList(
  req: Request, res: Response, userId: string, callSid: string
) {
  const { data: orders } = await supabaseAdmin
    .from('orders')
    .select('id, status, total_cents, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!orders || orders.length === 0) {
    res.type('text/xml').send(
      buildGather({
        prompt: 'You have no orders. Press star for the Main Menu.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 8,
        sessionData: { call_sid: callSid, user_id: userId, step: 'main_menu' },
      })
    );
    return;
  }

  const lines = orders.map((o, idx) => {
    const shortId = o.id.slice(-6).toUpperCase();
    const date = new Date(o.created_at).toLocaleDateString('en-US');
    return `Order ${idx + 1}: number ${shortId}, placed on ${date}, status ${o.status}, total ${formatCurrency(o.total_cents)}`;
  });

  res.type('text/xml').send(
    buildGather({
      prompt: `${lines.join('. ')}. To hear details about an order, enter the order number from 1 to ${orders.length}. Press star for Main Menu.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
      numDigits: 1,
      timeout: 10,
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'orders_detail',
        order_ids: orders.map((o) => o.id).join(','),
      },
    })
  );
}

async function handleOrderDetail(
  req: Request, res: Response, userId: string, callSid: string
) {
  const digits = req.body.Digits;
  const orderIds = (req.query.order_ids as string || '').split(',');

  if (digits === '*') {
    res.type('text/xml').send(buildMainMenuTwiml(callSid, userId));
    return;
  }

  const idx = parseInt(digits || '0', 10) - 1;
  if (idx < 0 || idx >= orderIds.length) {
    res.type('text/xml').send(
      buildSay(
        'Invalid selection.',
        `/api/twilio/voice/gather?step=orders_list&user_id=${userId}&call_sid=${callSid}`
      )
    );
    return;
  }

  const orderId = orderIds[idx];

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', orderId)
    .single();

  if (!order) {
    res.type('text/xml').send(
      buildSay(
        'Order not found.',
        `/api/twilio/voice/gather?step=orders_list&user_id=${userId}&call_sid=${callSid}`
      )
    );
    return;
  }

  const itemLines = (order.order_items || []).map(
    (oi: any) => `${oi.product_name}, quantity ${oi.quantity}, at ${formatCurrency(oi.unit_price_cents)} each`
  );

  const shortId = order.id.slice(-6).toUpperCase();

  res.type('text/xml').send(
    buildGather({
      prompt: `Order ${shortId}. Status: ${order.status}. Total: ${formatCurrency(order.total_cents)}. Items: ${itemLines.join('. ')}. Press star for Main Menu, or press 0 to go back to the orders list.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
      numDigits: 1,
      timeout: 10,
      sessionData: { call_sid: callSid, user_id: userId, step: 'orders_list' },
    })
  );
}
