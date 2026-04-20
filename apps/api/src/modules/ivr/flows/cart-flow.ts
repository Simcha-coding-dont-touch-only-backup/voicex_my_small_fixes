import type { Request, Response } from 'express';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildGather, buildSay, formatCurrency } from '../../teltech/teltech-builder.js';
import { normalizeInput, normalizeVoicexId } from '../../teltech/input-normalizer.js';
import { getProductDisplayName } from '@voicex/shared';
import { buildMainMenuResponse } from './pin-flow.js';
import type { IvrIntent } from '@voicex/shared';

const CART_INTENTS: IvrIntent[] = [
  { name: 'list_items', dtmf_key: '1', speech_phrases: ['list', 'one', 'list items', 'hear items'], target_node_key: 'cart_list' },
  { name: 'checkout', dtmf_key: '2', speech_phrases: ['checkout', 'two', 'proceed'], target_node_key: 'checkout' },
  { name: 'change_item', dtmf_key: '3', speech_phrases: ['change', 'three', 'change item', 'edit', 'modify'], target_node_key: 'cart_change_id' },
  { name: 'remove_item', dtmf_key: '4', speech_phrases: ['remove', 'four', 'remove item', 'delete'], target_node_key: 'cart_remove_id' },
  { name: 'main_menu', dtmf_key: '*', speech_phrases: ['main menu', 'back', 'star'], target_node_key: 'main_menu' },
];

export async function handleCartFlow(req: Request, res: Response) {
  const step = req.query.step as string;
  const userId = req.query.user_id as string;
  const callSid = req.query.call_sid as string;

  switch (step) {
    case 'cart_menu':
      return handleCartMenu(req, res, userId, callSid);
    case 'cart_list':
      return handleCartList(req, res, userId, callSid);
    case 'cart_change_id':
      return handleCartChangeId(req, res, userId, callSid);
    case 'cart_change_qty':
      return handleCartChangeQty(req, res, userId, callSid);
    case 'cart_change_confirm':
      return handleCartChangeConfirm(req, res, userId, callSid);
    case 'cart_remove_id':
      return handleCartRemoveId(req, res, userId, callSid);
    case 'cart_remove_confirm':
      return handleCartRemoveConfirm(req, res, userId, callSid);
  }
}

async function getCartSummary(userId: string) {
  const { data: cart } = await supabaseAdmin
    .from('carts')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (!cart) return null;

  const { data: items } = await supabaseAdmin
    .from('cart_items')
    .select('*, catalog_products(*)')
    .eq('cart_id', cart.id);

  if (!items || items.length === 0) return null;

  const itemCount = items.length;
  const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalCents = items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);

  return { cartId: cart.id, items, itemCount, totalQty, totalCents };
}

async function handleCartMenu(
  req: Request, res: Response, userId: string, callSid: string
) {
  const summary = await getCartSummary(userId);

  if (!summary) {
    res.json(
      buildGather({
        prompt: 'Your cart is empty. Press 1 to browse the catalog, or press star for the main menu.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 8,
        sessionData: { call_sid: callSid, user_id: userId, step: 'main_menu' },
      })
    );
    return;
  }

  const digits = req.body.digits;

  if (digits) {
    const input = normalizeInput(digits, CART_INTENTS);
    switch (input.matchedIntent) {
      case 'list_items':
        return handleCartList(req, res, userId, callSid);
      case 'checkout':
        res.json(
          buildSay(
            'Proceeding to checkout.',
            '/api/ivr/voice/gather',
            { step: 'checkout_address_choice', user_id: userId, call_sid: callSid }
          )
        );
        return;
      case 'change_item':
        res.json(
          buildGather({
            prompt: 'Enter the catalog number of the item you want to change.',
            actionPath: '/api/ivr/voice/gather',
            timeout: 10,
            finishOnKey: '#',
            sessionData: { call_sid: callSid, user_id: userId, step: 'cart_change_id' },
          })
        );
        return;
      case 'remove_item':
        res.json(
          buildGather({
            prompt: 'Enter the catalog number of the item you want to remove.',
            actionPath: '/api/ivr/voice/gather',
            timeout: 10,
            finishOnKey: '#',
            sessionData: { call_sid: callSid, user_id: userId, step: 'cart_remove_id' },
          })
        );
        return;
      case 'main_menu':
        res.json(buildMainMenuResponse(callSid, userId));
        return;
    }
  }

  res.json(
    buildGather({
      prompt: `Your cart has ${summary.itemCount} product${summary.itemCount === 1 ? '' : 's'} with a total quantity of ${summary.totalQty} and a total price of ${formatCurrency(summary.totalCents)}. Press 1 to hear all items. Press 2 to checkout. Press 3 to change an item. Press 4 to remove an item. Press star for Main Menu.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      sessionData: { call_sid: callSid, user_id: userId, step: 'cart_menu' },
    })
  );
}

async function handleCartList(
  req: Request, res: Response, userId: string, callSid: string
) {
  const summary = await getCartSummary(userId);
  if (!summary) {
    res.json(
      buildSay('Your cart is empty.', '/api/ivr/voice/gather', { step: 'main_menu', user_id: userId, call_sid: callSid })
    );
    return;
  }

  const lines = summary.items.map((item, idx) => {
    const name = getProductDisplayName(item.catalog_products);
    return `Item ${idx + 1}: ${name}, quantity ${item.quantity}, at ${formatCurrency(item.unit_price_cents)} each`;
  });

  res.json(
    buildGather({
      prompt: `${lines.join('. ')}. Total: ${formatCurrency(summary.totalCents)}. Press 2 to checkout. Press 3 to change an item. Press 4 to remove an item. Press star for Main Menu.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      sessionData: { call_sid: callSid, user_id: userId, step: 'cart_menu' },
    })
  );
}

async function handleCartChangeId(
  req: Request, res: Response, userId: string, callSid: string
) {
  const digits = req.body.digits;
  if (!digits) {
    res.json(
      buildGather({
        prompt: 'Enter the catalog number of the item to change.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'cart_change_id' },
      })
    );
    return;
  }

  const lookupId = normalizeVoicexId(digits);
  const summary = await getCartSummary(userId);
  const item = summary?.items.find((i) => i.voicex_id === lookupId);

  if (!item) {
    res.json(
      buildGather({
        prompt: `No item with catalog number ${digits.split('').join(' ')} found in your cart. Try again or press star for Main Menu.`,
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'cart_change_id' },
      })
    );
    return;
  }

  res.json(
    buildGather({
      prompt: `Current quantity is ${item.quantity}. Enter the new quantity.`,
      actionPath: '/api/ivr/voice/gather',
      timeout: 10,
      finishOnKey: '#',
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'cart_change_qty',
        cart_item_id: item.id,
        voicex_id: lookupId,
      },
    })
  );
}

async function handleCartChangeQty(
  req: Request, res: Response, userId: string, callSid: string
) {
  const cartItemId = req.query.cart_item_id as string;
  const voicexId = req.query.voicex_id as string;
  const digits = req.body.digits;
  const qty = parseInt(digits || '0', 10);

  if (!qty || qty <= 0) {
    res.json(
      buildGather({
        prompt: 'Enter a valid quantity.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'cart_change_qty',
          cart_item_id: cartItemId,
          voicex_id: voicexId,
        },
      })
    );
    return;
  }

  res.json(
    buildGather({
      prompt: `Change quantity to ${qty}. Press 1 to confirm, or press 2 to re-enter.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'cart_change_confirm',
        cart_item_id: cartItemId,
        voicex_id: voicexId,
        qty: qty.toString(),
      },
    })
  );
}

async function handleCartChangeConfirm(
  req: Request, res: Response, userId: string, callSid: string
) {
  const cartItemId = req.query.cart_item_id as string;
  const qty = parseInt(req.query.qty as string, 10);
  const digits = req.body.digits;

  if (digits === '2') {
    res.json(
      buildGather({
        prompt: 'Enter the new quantity.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'cart_change_qty',
          cart_item_id: cartItemId,
        },
      })
    );
    return;
  }

  await supabaseAdmin
    .from('cart_items')
    .update({ quantity: qty })
    .eq('id', cartItemId);

  res.json(
    buildSay(
      'Quantity updated.',
      '/api/ivr/voice/gather',
      { step: 'cart_menu', user_id: userId, call_sid: callSid }
    )
  );
}

async function handleCartRemoveId(
  req: Request, res: Response, userId: string, callSid: string
) {
  const digits = req.body.digits;
  if (!digits) {
    res.json(
      buildGather({
        prompt: 'Enter the catalog number of the item to remove.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'cart_remove_id' },
      })
    );
    return;
  }

  const lookupId = normalizeVoicexId(digits);
  const summary = await getCartSummary(userId);
  const item = summary?.items.find((i) => i.voicex_id === lookupId);

  if (!item) {
    res.json(
      buildGather({
        prompt: `Item not found in cart. Try again or press star for Main Menu.`,
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'cart_remove_id' },
      })
    );
    return;
  }

  const name = getProductDisplayName(item.catalog_products);

  res.json(
    buildGather({
      prompt: `Remove ${name} from your cart? Press 1 to confirm, or press 2 to cancel.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'cart_remove_confirm',
        cart_item_id: item.id,
      },
    })
  );
}

async function handleCartRemoveConfirm(
  req: Request, res: Response, userId: string, callSid: string
) {
  const cartItemId = req.query.cart_item_id as string;
  const digits = req.body.digits;

  if (digits === '2') {
    res.json(
      buildSay(
        'Removal cancelled.',
        '/api/ivr/voice/gather',
        { step: 'cart_menu', user_id: userId, call_sid: callSid }
      )
    );
    return;
  }

  await supabaseAdmin.from('cart_items').delete().eq('id', cartItemId);

  res.json(
    buildSay(
      'Item removed from your cart.',
      '/api/ivr/voice/gather',
      { step: 'cart_menu', user_id: userId, call_sid: callSid }
    )
  );
}
