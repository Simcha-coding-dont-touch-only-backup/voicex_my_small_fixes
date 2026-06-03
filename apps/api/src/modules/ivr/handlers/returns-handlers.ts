import { registerHandler } from '../handler-registry.js';
import { buildGather, buildSay, formatCurrency } from '../../teltech/teltech-builder.js';
import { normalizeVoicexId } from '../../teltech/input-normalizer.js';
import { orderIdFromParam, formatOrderIdForSpeech } from '@voicex/shared';
import { ivrRuntime } from '../runtime.js';
import { supabaseAdmin } from '../../../lib/supabase.js';
import {
  loadReturnableOrder,
  createReturn,
  type ReturnableLine,
  type ReturnableOrder,
} from '../../../lib/returns.js';

const GATHER_PATH = '/api/ivr/voice/gather';

const RETURN_PROCESSED_MESSAGE =
  'Your order will be processed for return. The money will be refunded to your card once we confirm the items have been returned to Amazon.';

interface DraftLine {
  order_item_id: string;
  quantity: number;
}

interface ReturnDraft {
  order_id: string;
  lines: DraftLine[];
}

function base(ctx: any): Record<string, string> {
  return { call_sid: ctx.callSid, user_id: ctx.sessionData.user_id };
}

function gather(prompt: string, sessionData: Record<string, string>, opts?: { numDigits?: number; finishOnKey?: string; timeout?: number; tries?: number }) {
  return {
    type: 'actions' as const,
    response: buildGather({
      prompt,
      actionPath: GATHER_PATH,
      numDigits: opts?.numDigits,
      finishOnKey: opts?.finishOnKey,
      timeout: opts?.timeout ?? 10,
      tries: opts?.tries,
      sessionData,
    }),
  };
}

function sayToMainMenu(ctx: any, message: string) {
  return {
    type: 'actions' as const,
    response: buildSay(message, GATHER_PATH, { ...base(ctx), node_key: 'main_menu' }),
  };
}

async function getDraft(callSid: string): Promise<ReturnDraft | null> {
  const session = await ivrRuntime.getSession(callSid);
  const draft = (session?.state_data as any)?.return_draft;
  if (draft && Array.isArray(draft.lines)) return draft as ReturnDraft;
  return null;
}

async function setDraft(callSid: string, draft: ReturnDraft | null): Promise<void> {
  const session = await ivrRuntime.getSession(callSid);
  const stateData = { ...((session?.state_data as Record<string, unknown>) || {}) };
  if (draft === null) {
    delete stateData.return_draft;
  } else {
    stateData.return_draft = draft;
  }
  await ivrRuntime.updateSession(callSid, { state_data: stateData });
}

async function addToDraft(callSid: string, orderId: string, orderItemId: string, qty: number): Promise<void> {
  const existing = (await getDraft(callSid)) || { order_id: orderId, lines: [] };
  const draft: ReturnDraft = existing.order_id === orderId ? existing : { order_id: orderId, lines: [] };
  const line = draft.lines.find((l) => l.order_item_id === orderItemId);
  if (line) {
    line.quantity += qty;
  } else {
    draft.lines.push({ order_item_id: orderItemId, quantity: qty });
  }
  await setDraft(callSid, draft);
}

/** Remaining quantity available to select right now: persisted remaining minus in-call draft. */
function effectiveRemaining(lines: ReturnableLine[], draft: ReturnDraft | null): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    let remaining = line.remaining_qty;
    const drafted = draft?.lines.find((l) => l.order_item_id === line.order_item_id)?.quantity ?? 0;
    remaining -= drafted;
    map.set(line.order_item_id, Math.max(0, remaining));
  }
  return map;
}

/** [03] confirmation prefix + the appropriate sub-menu ([04]/[06]/[08]). */
function routeToOrderMenu(ctx: any, data: ReturnableOrder) {
  const order = data.order;
  const lines = data.returnableLines;
  const idSpeech = formatOrderIdForSpeech(order.id);
  const count = lines.length;
  const confirm03 = `You have entered Order ${idSpeech} that contained ${count} ${count === 1 ? 'product' : 'products'} and with a total cost of ${formatCurrency(order.total_cents)}.`;

  if (lines.length === 1) {
    const line = lines[0];
    if (line.remaining_qty === 1) {
      // [04] single product, single qty
      return gather(
        `${confirm03} Your order only had a single product in it, ${line.product_name}. Press 1 to confirm that you would like to return the entire order. Press star to go back.`,
        { ...base(ctx), node_key: 'returns_single_confirm', order_id: order.id, line_item_id: line.order_item_id },
        { numDigits: 1 },
      );
    }
    // [06] single product, multiple qty
    return gather(
      `${confirm03} Your order contained 1 product, ${line.product_name}, with a quantity of ${line.remaining_qty}. To return all ${line.remaining_qty}, press 1. To return a partial quantity, press 2. Press star to go back.`,
      { ...base(ctx), node_key: 'returns_single_qty_choice', order_id: order.id, line_item_id: line.order_item_id },
      { numDigits: 1 },
    );
  }

  // [08] multiple products
  return gather(
    `${confirm03} To return your entire order, press 1. To return one or more specific products, or a partial quantity of any product, press 2. Press star to go back.`,
    { ...base(ctx), node_key: 'returns_multi_choice', order_id: order.id },
    { numDigits: 1 },
  );
}

// [01] Returns menu is a plain `menu` node seeded in the migration; pressing 1
// routes to returns_order_entry and pressing 2 routes to returns_recent_list.

// [02] Enter order number / validate / route.
registerHandler('returns_order_entry', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;

  if (!digits) {
    return gather(
      'Please enter your 5 digit VoiceX order number.',
      { ...base(ctx), node_key: 'returns_order_entry' },
      { numDigits: 5, finishOnKey: '' },
    );
  }

  const orderId = orderIdFromParam(digits);
  if (!orderId) {
    return gather(
      'You have entered an invalid order ID. Please enter your 5 digit VoiceX order number.',
      { ...base(ctx), node_key: 'returns_order_entry' },
      { numDigits: 5, finishOnKey: '' },
    );
  }

  const eligibility = await loadReturnableOrder(orderId, userId);
  if (!eligibility.ok) {
    if (eligibility.reason === 'too_old') {
      return gather(
        'Sorry, that order is too old and is no longer returnable. Please enter a different 5 digit VoiceX order number.',
        { ...base(ctx), node_key: 'returns_order_entry' },
        { numDigits: 5, finishOnKey: '' },
      );
    }
    if (eligibility.reason === 'fully_returned') {
      return gather(
        'That order has already been fully returned. Please enter a different 5 digit VoiceX order number.',
        { ...base(ctx), node_key: 'returns_order_entry' },
        { numDigits: 5, finishOnKey: '' },
      );
    }
    return gather(
      'You have entered an invalid order ID. Please enter your 5 digit VoiceX order number.',
      { ...base(ctx), node_key: 'returns_order_entry' },
      { numDigits: 5, finishOnKey: '' },
    );
  }

  await setDraft(ctx.callSid, null);
  return routeToOrderMenu(ctx, eligibility.data);
});

// [Return Node 01 -> 2] Hear a list of recent orders, then select one.
registerHandler('returns_recent_list', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const orderIdsCsv = ctx.sessionData.order_ids;

  // Selection of a previously listed order.
  if (digits && orderIdsCsv) {
    const orderIds = orderIdsCsv.split(',').filter(Boolean);
    const idx = parseInt(digits, 10) - 1;
    if (idx >= 0 && idx < orderIds.length) {
      const eligibility = await loadReturnableOrder(orderIds[idx], userId);
      if (eligibility.ok) {
        await setDraft(ctx.callSid, null);
        return routeToOrderMenu(ctx, eligibility.data);
      }
    }
    return gather(
      'That was not a valid selection. Please try again.',
      { ...base(ctx), node_key: 'returns_recent_list', order_ids: orderIdsCsv },
      { numDigits: 1 },
    );
  }

  // List recent returnable orders (last 30 days, returnable status, with items left).
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders } = await supabaseAdmin
    .from('orders')
    .select('id, created_at')
    .eq('user_id', userId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(20);

  const returnable: Array<{ id: string; productCount: number; total: number }> = [];
  for (const o of orders || []) {
    if (returnable.length >= 9) break;
    const eligibility = await loadReturnableOrder(String(o.id), userId);
    if (eligibility.ok) {
      returnable.push({
        id: eligibility.data.order.id,
        productCount: eligibility.data.returnableLines.length,
        total: eligibility.data.order.total_cents,
      });
    }
  }

  if (returnable.length === 0) {
    return sayToMainMenu(ctx, 'Sorry, you have no orders that were made within the past 30 days. Returning to the main menu.');
  }

  const lines = returnable.map((o, i) => {
    const idSpeech = formatOrderIdForSpeech(o.id);
    return `To select order ${idSpeech}, which contained ${o.productCount} ${o.productCount === 1 ? 'product' : 'products'} with a total price of ${formatCurrency(o.total)}, press ${i + 1}`;
  });

  return gather(
    `${lines.join('. ')}. Press star to go back.`,
    { ...base(ctx), node_key: 'returns_recent_list', order_ids: returnable.map((o) => o.id).join(',') },
    { numDigits: 1, timeout: 12 },
  );
});

// [04] single product, single qty -> confirm.
registerHandler('returns_single_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const orderId = ctx.sessionData.order_id;
  const lineItemId = ctx.sessionData.line_item_id;
  const digits = ctx.req.body.digits;

  if (digits === '1') {
    const result = await createReturn({ orderId, userId, selections: [{ order_item_id: lineItemId, quantity: 1 }], source: 'ivr' });
    await setDraft(ctx.callSid, null);
    return sayToMainMenu(ctx, result ? RETURN_PROCESSED_MESSAGE : 'We were unable to process your return. Returning to the main menu.');
  }

  const eligibility = await loadReturnableOrder(orderId, userId);
  if (!eligibility.ok) return sayToMainMenu(ctx, 'We were unable to process your return. Returning to the main menu.');
  const line = eligibility.data.returnableLines[0];
  return gather(
    `Your order only had a single product in it, ${line?.product_name ?? 'this product'}. Press 1 to confirm that you would like to return the entire order. Press star to go back.`,
    { ...base(ctx), node_key: 'returns_single_confirm', order_id: orderId, line_item_id: lineItemId },
    { numDigits: 1 },
  );
});

// [06] single product, multiple qty -> all or partial.
registerHandler('returns_single_qty_choice', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const orderId = ctx.sessionData.order_id;
  const lineItemId = ctx.sessionData.line_item_id;
  const digits = ctx.req.body.digits;

  const eligibility = await loadReturnableOrder(orderId, userId);
  if (!eligibility.ok) return sayToMainMenu(ctx, 'We were unable to process your return. Returning to the main menu.');
  const line = eligibility.data.returnableLines.find((l) => l.order_item_id === lineItemId) || eligibility.data.returnableLines[0];

  if (digits === '1') {
    const result = await createReturn({ orderId, userId, selections: [{ order_item_id: line.order_item_id, quantity: line.remaining_qty }], source: 'ivr' });
    await setDraft(ctx.callSid, null);
    return sayToMainMenu(ctx, result ? RETURN_PROCESSED_MESSAGE : 'We were unable to process your return. Returning to the main menu.');
  }

  if (digits === '2') {
    return gather(
      'Enter the quantity you would like to return, then press pound.',
      { ...base(ctx), node_key: 'returns_qty_entry', order_id: orderId, line_item_id: line.order_item_id, flow_mode: 'single' },
      { finishOnKey: '#' },
    );
  }

  return gather(
    `Your order contained 1 product, ${line.product_name}, with a quantity of ${line.remaining_qty}. To return all ${line.remaining_qty}, press 1. To return a partial quantity, press 2. Press star to go back.`,
    { ...base(ctx), node_key: 'returns_single_qty_choice', order_id: orderId, line_item_id: line.order_item_id },
    { numDigits: 1 },
  );
});

// [07] enter partial quantity -> [18] confirm.
registerHandler('returns_qty_entry', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const orderId = ctx.sessionData.order_id;
  const lineItemId = ctx.sessionData.line_item_id;
  const flowMode = ctx.sessionData.flow_mode === 'multi' ? 'multi' : 'single';
  const digits = ctx.req.body.digits;

  if (!digits) {
    return gather(
      'Enter the quantity you would like to return, then press pound.',
      { ...base(ctx), node_key: 'returns_qty_entry', order_id: orderId, line_item_id: lineItemId, flow_mode: flowMode },
      { finishOnKey: '#' },
    );
  }

  const eligibility = await loadReturnableOrder(orderId, userId);
  if (!eligibility.ok) return sayToMainMenu(ctx, 'We were unable to process your return. Returning to the main menu.');

  const draft = flowMode === 'multi' ? await getDraft(ctx.callSid) : null;
  const remainingMap = effectiveRemaining(eligibility.data.returnableLines, draft);
  const line = eligibility.data.returnableLines.find((l) => l.order_item_id === lineItemId);
  const remaining = line ? remainingMap.get(lineItemId) ?? 0 : 0;

  const qty = parseInt(digits, 10);
  if (!line || !qty || qty < 1 || qty > remaining) {
    return gather(
      `Please enter a valid quantity between 1 and ${remaining}, then press pound.`,
      { ...base(ctx), node_key: 'returns_qty_entry', order_id: orderId, line_item_id: lineItemId, flow_mode: flowMode },
      { finishOnKey: '#' },
    );
  }

  return gather(
    `Please press 1 to confirm that you would like to return ${qty} out of ${remaining} of ${line.product_name}. Press star to go back.`,
    { ...base(ctx), node_key: 'returns_qty_confirm', order_id: orderId, line_item_id: lineItemId, flow_mode: flowMode, qty: String(qty) },
    { numDigits: 1 },
  );
});

// [18] confirm partial quantity.
registerHandler('returns_qty_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const orderId = ctx.sessionData.order_id;
  const lineItemId = ctx.sessionData.line_item_id;
  const flowMode = ctx.sessionData.flow_mode === 'multi' ? 'multi' : 'single';
  const qty = parseInt(ctx.sessionData.qty || '0', 10);
  const digits = ctx.req.body.digits;

  if (digits !== '1') {
    return gather(
      `Please press 1 to confirm that you would like to return ${qty} of this product. Press star to go back.`,
      { ...base(ctx), node_key: 'returns_qty_confirm', order_id: orderId, line_item_id: lineItemId, flow_mode: flowMode, qty: String(qty) },
      { numDigits: 1 },
    );
  }

  if (flowMode === 'single') {
    const result = await createReturn({ orderId, userId, selections: [{ order_item_id: lineItemId, quantity: qty }], source: 'ivr' });
    await setDraft(ctx.callSid, null);
    return sayToMainMenu(ctx, result ? RETURN_PROCESSED_MESSAGE : 'We were unable to process your return. Returning to the main menu.');
  }

  // multi: add to draft, then product-added menu [12]
  await addToDraft(ctx.callSid, orderId, lineItemId, qty);
  return gather(
    'Confirmed, this product will be processed for return. To return another product, press 1. To finalize your return, press 2.',
    { ...base(ctx), node_key: 'returns_product_added', order_id: orderId },
    { numDigits: 1 },
  );
});

// [08] multiple products: entire order or specific products.
registerHandler('returns_multi_choice', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const orderId = ctx.sessionData.order_id;
  const digits = ctx.req.body.digits;

  const eligibility = await loadReturnableOrder(orderId, userId);
  if (!eligibility.ok) return sayToMainMenu(ctx, 'We were unable to process your return. Returning to the main menu.');

  if (digits === '1') {
    const selections = eligibility.data.returnableLines.map((l) => ({ order_item_id: l.order_item_id, quantity: l.remaining_qty }));
    const result = await createReturn({ orderId, userId, selections, source: 'ivr' });
    await setDraft(ctx.callSid, null);
    return sayToMainMenu(ctx, result ? RETURN_PROCESSED_MESSAGE : 'We were unable to process your return. Returning to the main menu.');
  }

  if (digits === '2') {
    await setDraft(ctx.callSid, { order_id: orderId, lines: [] });
    return gather(
      'If you know the VoiceX IDs of the products you would like to return, press 1. To hear a list of all the products that were included in the order, press 2. Press star to go back.',
      { ...base(ctx), node_key: 'returns_multi_method', order_id: orderId },
      { numDigits: 1 },
    );
  }

  return gather(
    'To return your entire order, press 1. To return one or more specific products, or a partial quantity of any product, press 2. Press star to go back.',
    { ...base(ctx), node_key: 'returns_multi_choice', order_id: orderId },
    { numDigits: 1 },
  );
});

// [10] enter a VoiceX ID to return.
registerHandler('returns_product_entry', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const orderId = ctx.sessionData.order_id;
  const digits = ctx.req.body.digits;

  if (!digits) {
    return gather(
      'Enter the VoiceX ID of the product you would like to return, then press pound.',
      { ...base(ctx), node_key: 'returns_product_entry', order_id: orderId },
      { finishOnKey: '#' },
    );
  }

  const eligibility = await loadReturnableOrder(orderId, userId);
  if (!eligibility.ok) return sayToMainMenu(ctx, 'We were unable to process your return. Returning to the main menu.');

  const draft = await getDraft(ctx.callSid);
  const remainingMap = effectiveRemaining(eligibility.data.returnableLines, draft);
  const lookupId = normalizeVoicexId(digits);
  const line = eligibility.data.returnableLines.find(
    (l) => l.voicex_id === lookupId && (remainingMap.get(l.order_item_id) ?? 0) > 0,
  );

  if (!line) {
    return gather(
      'That product was not found in your order, or it has already been added to your return. Enter a different VoiceX ID, then press pound.',
      { ...base(ctx), node_key: 'returns_product_entry', order_id: orderId },
      { finishOnKey: '#' },
    );
  }

  return productSelectedResponse(ctx, orderId, line, remainingMap.get(line.order_item_id) ?? 0);
});

// [14] hear a list of all products, select by number.
registerHandler('returns_product_list', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const orderId = ctx.sessionData.order_id;
  const digits = ctx.req.body.digits;
  const lineIdsCsv = ctx.sessionData.line_ids;

  const eligibility = await loadReturnableOrder(orderId, userId);
  if (!eligibility.ok) return sayToMainMenu(ctx, 'We were unable to process your return. Returning to the main menu.');

  const draft = await getDraft(ctx.callSid);
  const remainingMap = effectiveRemaining(eligibility.data.returnableLines, draft);

  // Selection from a previously read list.
  if (digits && lineIdsCsv) {
    const ids = lineIdsCsv.split(',').filter(Boolean);
    const idx = parseInt(digits, 10) - 1;
    const lineId = ids[idx];
    const line = lineId ? eligibility.data.returnableLines.find((l) => l.order_item_id === lineId) : undefined;
    if (line && (remainingMap.get(line.order_item_id) ?? 0) > 0) {
      return productSelectedResponse(ctx, orderId, line, remainingMap.get(line.order_item_id) ?? 0);
    }
  }

  const available = eligibility.data.returnableLines.filter((l) => (remainingMap.get(l.order_item_id) ?? 0) > 0);
  if (available.length === 0) {
    return sayToMainMenu(ctx, 'There are no more products available to return on this order. Returning to the main menu.');
  }

  const items = available.map((l, i) => `To return ${l.product_name}, press ${i + 1}`);
  return gather(
    `Here is a list of the products in your order. To return a product, press its number followed by pound. ${items.join('. ')}.`,
    { ...base(ctx), node_key: 'returns_product_list', order_id: orderId, line_ids: available.map((l) => l.order_item_id).join(',') },
    { finishOnKey: '#', timeout: 3, tries: 3 },
  );
});

// Shared: a product was selected (via VoiceX ID or list) -> [11] or [13].
function productSelectedResponse(ctx: any, orderId: string, line: ReturnableLine, remaining: number) {
  if (remaining === 1) {
    // [11]
    return gather(
      `Press 1 to confirm that you would like to return ${line.product_name}. Press star to go back.`,
      { ...base(ctx), node_key: 'returns_product_confirm', order_id: orderId, line_item_id: line.order_item_id },
      { numDigits: 1 },
    );
  }
  // [13]
  return gather(
    `Product ${line.product_name} contained a quantity of ${remaining}. To return all ${remaining}, press 1. To return a partial quantity, press 2. Press star to go back.`,
    { ...base(ctx), node_key: 'returns_product_qty_choice', order_id: orderId, line_item_id: line.order_item_id },
    { numDigits: 1 },
  );
}

// [11] confirm a single-qty product.
registerHandler('returns_product_confirm', async (ctx) => {
  const orderId = ctx.sessionData.order_id;
  const lineItemId = ctx.sessionData.line_item_id;
  const digits = ctx.req.body.digits;

  if (digits === '1') {
    await addToDraft(ctx.callSid, orderId, lineItemId, 1);
    return gather(
      'Confirmed, this product will be processed for return. To return another product, press 1. To finalize your return, press 2.',
      { ...base(ctx), node_key: 'returns_product_added', order_id: orderId },
      { numDigits: 1 },
    );
  }

  return gather(
    'Press 1 to confirm that you would like to return this product. Press star to go back.',
    { ...base(ctx), node_key: 'returns_product_confirm', order_id: orderId, line_item_id: lineItemId },
    { numDigits: 1 },
  );
});

// [13] product with multiple qty: all or partial.
registerHandler('returns_product_qty_choice', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const orderId = ctx.sessionData.order_id;
  const lineItemId = ctx.sessionData.line_item_id;
  const digits = ctx.req.body.digits;

  const eligibility = await loadReturnableOrder(orderId, userId);
  if (!eligibility.ok) return sayToMainMenu(ctx, 'We were unable to process your return. Returning to the main menu.');
  const draft = await getDraft(ctx.callSid);
  const remainingMap = effectiveRemaining(eligibility.data.returnableLines, draft);
  const line = eligibility.data.returnableLines.find((l) => l.order_item_id === lineItemId);
  const remaining = line ? remainingMap.get(lineItemId) ?? 0 : 0;

  if (!line || remaining <= 0) {
    return sayToMainMenu(ctx, 'That product is no longer available to return. Returning to the main menu.');
  }

  if (digits === '1') {
    await addToDraft(ctx.callSid, orderId, lineItemId, remaining);
    return gather(
      'Confirmed, this product will be processed for return. To return another product, press 1. To finalize your return, press 2.',
      { ...base(ctx), node_key: 'returns_product_added', order_id: orderId },
      { numDigits: 1 },
    );
  }

  if (digits === '2') {
    return gather(
      'Enter the quantity you would like to return, then press pound.',
      { ...base(ctx), node_key: 'returns_qty_entry', order_id: orderId, line_item_id: lineItemId, flow_mode: 'multi' },
      { finishOnKey: '#' },
    );
  }

  return gather(
    `Product ${line.product_name} contained a quantity of ${remaining}. To return all ${remaining}, press 1. To return a partial quantity, press 2. Press star to go back.`,
    { ...base(ctx), node_key: 'returns_product_qty_choice', order_id: orderId, line_item_id: lineItemId },
    { numDigits: 1 },
  );
});

// [12] product added: continue or finalize.
registerHandler('returns_product_added', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const orderId = ctx.sessionData.order_id;
  const digits = ctx.req.body.digits;

  if (digits === '1') {
    return gather(
      'Enter the VoiceX ID of the next product you would like to return, then press pound.',
      { ...base(ctx), node_key: 'returns_product_entry', order_id: orderId },
      { finishOnKey: '#' },
    );
  }

  if (digits === '2') {
    const draft = await getDraft(ctx.callSid);
    const selections = (draft?.lines || []).map((l) => ({ order_item_id: l.order_item_id, quantity: l.quantity }));
    if (selections.length === 0) {
      return sayToMainMenu(ctx, 'No products were selected for return. Returning to the main menu.');
    }
    const result = await createReturn({ orderId, userId, selections, source: 'ivr' });
    await setDraft(ctx.callSid, null);
    return sayToMainMenu(ctx, result ? RETURN_PROCESSED_MESSAGE : 'We were unable to process your return. Returning to the main menu.');
  }

  return gather(
    'To return another product, press 1. To finalize your return, press 2.',
    { ...base(ctx), node_key: 'returns_product_added', order_id: orderId },
    { numDigits: 1 },
  );
});
