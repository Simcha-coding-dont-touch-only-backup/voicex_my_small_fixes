import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildGatherFromNode, buildSay, formatCurrency } from '../../teltech/teltech-builder.js';
import { normalizeInput, normalizeVoicexId } from '../../teltech/input-normalizer.js';
import { getProductDisplayName } from '@voicex/shared';
import { ivrRuntime } from '../runtime.js';

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

registerHandler('cart_summary', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const summary = await getCartSummary(userId);

  if (!summary) {
    const mainNode = await ivrRuntime.getNodeByKey(ctx.flowVersionId, 'main_menu');
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Your cart is empty. Press 1 to browse the catalog, or press star for the main menu.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: mainNode ? mainNode.config.num_digits : 1,
        timeout: mainNode?.config.timeout_seconds || 8,
        finishOnKey: mainNode?.config.finish_on_key,
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' },
      }),
    };
  }

  const intents = ctx.node.config.intents || [];

  if (digits) {
    const input = normalizeInput(digits, intents);
    if (input.matchedIntent) {
      const targetNodeKey = intents.find((i: any) => i.name === input.matchedIntent)?.target_node_key;
      if (targetNodeKey) {
        if (targetNodeKey === 'checkout_address_choice') {
          return {
            type: 'actions',
            response: buildSay(
              'Proceeding to checkout.',
              '/api/ivr/voice/gather',
              { call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_address_choice' }
            ),
          };
        }
        const targetNode = await ivrRuntime.getNodeByKey(ctx.flowVersionId, targetNodeKey);
        if (targetNode) {
          if (targetNode.node_type === 'action' && targetNode.handler_name) {
            return {
              type: 'actions',
              response: buildSay(
                targetNode.prompt_text || 'Processing.',
                '/api/ivr/voice/gather',
                { call_sid: ctx.callSid, user_id: userId, node_key: targetNode.node_key }
              ),
            };
          }
          return {
            type: 'actions',
            response: buildGather({
              prompt: targetNode.prompt_text || 'Please continue.',
              actionPath: '/api/ivr/voice/gather',
              numDigits: targetNode.config.num_digits,
              timeout: targetNode.config.timeout_seconds || 10,
              finishOnKey: targetNode.config.finish_on_key,
              sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: targetNode.node_key },
            }),
          };
        }
      }
    }
  }

  return {
    type: 'actions',
    response: buildGather({
      prompt: `Your cart has ${summary.itemCount} product${summary.itemCount === 1 ? '' : 's'} with a total quantity of ${summary.totalQty} and a total price of ${formatCurrency(summary.totalCents)}. ${ctx.node.prompt_text}`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: ctx.node.config.num_digits,
      timeout: ctx.node.config.timeout_seconds || 10,
      finishOnKey: ctx.node.config.finish_on_key,
      sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
    }),
  };
});

registerHandler('cart_list', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const summary = await getCartSummary(userId);

  if (!summary) {
    return {
      type: 'actions',
      response: buildSay('Your cart is empty.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }),
    };
  }

  const lines = summary.items.map((item: any, idx: number) => {
    const name = getProductDisplayName(item.catalog_products);
    return `Item ${idx + 1}: ${name}, quantity ${item.quantity}, at ${formatCurrency(item.unit_price_cents)} each`;
  });

  return {
    type: 'actions',
    response: buildGather({
      prompt: `${lines.join('. ')}. Total: ${formatCurrency(summary.totalCents)}. Press 2 to checkout. Press 3 to change an item. Press 4 to remove an item. Press 5 to empty your entire cart. Press star for Main Menu.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: ctx.node.config.num_digits,
      timeout: ctx.node.config.timeout_seconds || 10,
      finishOnKey: ctx.node.config.finish_on_key,
      sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' },
    }),
  };
});

registerHandler('cart_change_id', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;

  if (!digits) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: ctx.node.prompt_text || 'Enter the catalog number of the item to change.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const lookupId = normalizeVoicexId(digits);
  const summary = await getCartSummary(userId);
  const item = summary?.items.find(
    (i: any) => i.catalog_products?.voicex_id === lookupId || i.voicex_id === lookupId
  );

  if (!item) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: `No item with catalog number ${digits.split('').join(' ')} found in your cart. Try again or press star for Main Menu.`,
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'found');

  return {
    type: 'actions',
    response: buildGather({
      prompt: `Current quantity is ${item.quantity}. Enter the new quantity.`,
      actionPath: '/api/ivr/voice/gather',
      timeout: 10,
      finishOnKey: '#',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'cart_change_qty',
        cart_item_id: item.id, voicex_id: lookupId,
      },
    }),
  };
});

registerHandler('cart_change_qty', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const cartItemId = ctx.sessionData.cart_item_id;
  const voicexId = ctx.sessionData.voicex_id;
  const digits = ctx.req.body.digits;
  const qty = parseInt(digits || '0', 10);

  if (!qty || qty <= 0) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Enter a valid quantity.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          cart_item_id: cartItemId, voicex_id: voicexId,
        },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  if (nextNode) {
    return {
      type: 'actions',
      response: buildGatherFromNode(nextNode, {
        call_sid: ctx.callSid, user_id: userId,
        cart_item_id: cartItemId, voicex_id: voicexId, qty: qty.toString(),
      }, {
        prompt: `Change quantity to ${qty}. Press 1 to confirm, or press 2 to re-enter.`,
      }),
    };
  }

  return {
    type: 'actions',
    response: buildGather({
      prompt: `Change quantity to ${qty}. Press 1 to confirm, or press 2 to re-enter.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'cart_change_confirm',
        cart_item_id: cartItemId, voicex_id: voicexId, qty: qty.toString(),
      },
    }),
  };
});

registerHandler('cart_change_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const cartItemId = ctx.sessionData.cart_item_id;
  const qty = parseInt(ctx.sessionData.qty, 10);
  const digits = ctx.req.body.digits;

  if (digits === '2') {
    const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Enter the new quantity.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: retryNode?.node_key || 'cart_change_qty',
          cart_item_id: cartItemId,
        },
      }),
    };
  }

  await supabaseAdmin
    .from('cart_items')
    .update({ quantity: qty })
    .eq('id', cartItemId);

  return {
    type: 'actions',
    response: buildSay('Quantity updated.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }),
  };
});

registerHandler('cart_remove_id', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;

  if (!digits) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: ctx.node.prompt_text || 'Enter the catalog number of the item to remove.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const lookupId = normalizeVoicexId(digits);
  const summary = await getCartSummary(userId);
  const item = summary?.items.find(
    (i: any) => i.catalog_products?.voicex_id === lookupId || i.voicex_id === lookupId
  );

  if (!item) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Item not found in cart. Try again or press star for Main Menu.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const name = getProductDisplayName(item.catalog_products);
  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'found');

  if (nextNode) {
    return {
      type: 'actions',
      response: buildGatherFromNode(nextNode, {
        call_sid: ctx.callSid, user_id: userId,
        cart_item_id: item.id,
      }, {
        prompt: `Remove ${name} from your cart? Press 1 to confirm, or press 2 to cancel.`,
      }),
    };
  }

  return {
    type: 'actions',
    response: buildGather({
      prompt: `Remove ${name} from your cart? Press 1 to confirm, or press 2 to cancel.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'cart_remove_confirm',
        cart_item_id: item.id,
      },
    }),
  };
});

registerHandler('cart_remove_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const cartItemId = ctx.sessionData.cart_item_id;
  const digits = ctx.req.body.digits;

  if (digits === '2') {
    return {
      type: 'actions',
      response: buildSay('Removal cancelled.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }),
    };
  }

  const { data: removed } = await supabaseAdmin
    .from('cart_items')
    .delete()
    .eq('id', cartItemId)
    .select('cart_id')
    .single();

  if (removed?.cart_id) {
    const { count } = await supabaseAdmin
      .from('cart_items')
      .select('id', { count: 'exact', head: true })
      .eq('cart_id', removed.cart_id);
    if (count === 0) {
      await supabaseAdmin
        .from('carts')
        .delete()
        .eq('id', removed.cart_id)
        .neq('status', 'checked_out');
    }
  }

  return {
    type: 'actions',
    response: buildSay('Item removed from your cart.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }),
  };
});

registerHandler('cart_empty_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;

  if (!digits) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: ctx.node.prompt_text || 'Are you sure you want to remove all the items currently found in your cart? Press 1 to move ahead. Press 2 to cancel.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: ctx.node.config.num_digits || 1,
        timeout: ctx.node.config.timeout_seconds || 10,
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  if (digits === '2') {
    return {
      type: 'actions',
      response: buildSay(
        'Cancelled.',
        '/api/ivr/voice/gather',
        { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }
      ),
    };
  }

  if (digits === '1') {
    const { data: cart } = await supabaseAdmin
      .from('carts')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (cart) {
      await supabaseAdmin.from('cart_items').delete().eq('cart_id', cart.id);
      await supabaseAdmin
        .from('carts')
        .delete()
        .eq('id', cart.id)
        .neq('status', 'checked_out');
    }

    return {
      type: 'actions',
      response: buildSay(
        'All the items have successfully been removed from your cart.',
        '/api/ivr/voice/gather',
        { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
      ),
    };
  }

  return {
    type: 'actions',
    response: buildGather({
      prompt: 'Press 1 to move ahead. Press 2 to cancel.',
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: ctx.node.config.timeout_seconds || 10,
      sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
    }),
  };
});
