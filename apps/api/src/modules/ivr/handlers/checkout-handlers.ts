import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildSay, buildHangup, formatCurrency } from '../../teltech/teltech-builder.js';
import { validateAddress } from '../../../lib/google-address.js';
import { createRyeIntent, confirmRyeIntent, findCartItemForFailure } from '../../../lib/rye-checkout.js';
import type { StockFailure, IntentResult } from '../../../lib/rye-checkout.js';
import { getProductDisplayName } from '@voicex/shared';
import { ivrRuntime } from '../runtime.js';

const MAX_STOCK_RETRIES_PER_ITEM = 3;

registerHandler('address_choice', async (ctx) => {
  const userId = ctx.sessionData.user_id;

  const { data: addresses } = await supabaseAdmin
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });

  if (addresses && addresses.length > 0) {
    const defaultAddr = addresses[0];
    const addrStr = `${defaultAddr.address1}, ${defaultAddr.address2 || ''}, ${defaultAddr.city}, ${defaultAddr.state} ${defaultAddr.zip_code}`.replace(/, ,/g, ',');

    return {
      type: 'actions',
      response: buildGather({
        prompt: `Your saved address is: ${addrStr}. Press 1 to use this address, or press 2 to enter a new address.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_address_confirm',
          address_id: defaultAddr.id, use_saved: 'pending',
        },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'new_address');

  return {
    type: 'actions',
    response: buildGather({
      prompt: nextNode?.prompt_text || 'Please enter your street number and name followed by the pound key.',
      actionPath: '/api/ivr/voice/gather',
      timeout: 15,
      finishOnKey: '#',
      sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: nextNode?.node_key || 'checkout_address_line1' },
    }),
  };
});

registerHandler('address_line1', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const line1 = digits || '';

  if (!line1.trim()) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter your street address.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'actions',
    response: buildGather({
      prompt: nextNode?.prompt_text || 'Enter apartment or unit number, or press pound to skip.',
      actionPath: '/api/ivr/voice/gather',
      timeout: 10,
      finishOnKey: '#',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'checkout_address_line2',
        addr_line1: line1.trim(),
      },
    }),
  };
});

registerHandler('address_line2', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const line1 = ctx.sessionData.addr_line1;
  const digits = ctx.req.body.digits;
  const line2 = digits || '';

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'actions',
    response: buildGather({
      prompt: nextNode?.prompt_text || 'Enter your city name.',
      actionPath: '/api/ivr/voice/gather',
      timeout: 15,
      finishOnKey: '#',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'checkout_address_city',
        addr_line1: line1, addr_line2: line2.trim(),
      },
    }),
  };
});

registerHandler('address_city', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const line1 = ctx.sessionData.addr_line1;
  const line2 = ctx.sessionData.addr_line2;
  const city = ctx.req.body.digits || '';

  if (!city.trim()) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter your city name.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          addr_line1: line1, addr_line2: line2,
        },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'actions',
    response: buildGather({
      prompt: nextNode?.prompt_text || 'Enter your 2-letter state code.',
      actionPath: '/api/ivr/voice/gather',
      timeout: 10,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'checkout_address_state',
        addr_line1: line1, addr_line2: line2, addr_city: city.trim(),
      },
    }),
  };
});

registerHandler('address_state', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const line1 = ctx.sessionData.addr_line1;
  const line2 = ctx.sessionData.addr_line2;
  const city = ctx.sessionData.addr_city;
  const state = (ctx.req.body.digits || '').trim().toUpperCase().slice(0, 2);

  if (!state) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter your state code.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          addr_line1: line1, addr_line2: line2, addr_city: city,
        },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'actions',
    response: buildGather({
      prompt: nextNode?.prompt_text || 'Enter your 5-digit ZIP code.',
      actionPath: '/api/ivr/voice/gather',
      numDigits: 5,
      timeout: 10,
      finishOnKey: '',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'checkout_address_zip',
        addr_line1: line1, addr_line2: line2, addr_city: city, addr_state: state,
      },
    }),
  };
});

registerHandler('address_zip', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const line1 = ctx.sessionData.addr_line1;
  const line2 = ctx.sessionData.addr_line2;
  const city = ctx.sessionData.addr_city;
  const state = ctx.sessionData.addr_state;
  const zip = ctx.req.body.digits || '';

  if (zip.length !== 5) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter a valid 5-digit ZIP code.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 5,
        timeout: 10,
        finishOnKey: '',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          addr_line1: line1, addr_line2: line2, addr_city: city, addr_state: state,
        },
      }),
    };
  }

  try {
    const validation = await validateAddress({ address1: line1, address2: line2 || undefined, city, state, zipCode: zip });
    const fullAddress = validation.formattedAddress || `${line1}, ${line2 ? line2 + ', ' : ''}${city}, ${state} ${zip}`;
    const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

    return {
      type: 'actions',
      response: buildGather({
        prompt: `Your address is: ${fullAddress}. ${validation.isValid ? '' : 'Note: we detected some issues with this address. '}Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: nextNode?.node_key || 'checkout_address_confirm',
          addr_line1: validation.correctedAddress?.address1 || line1, addr_line2: line2,
          addr_city: validation.correctedAddress?.city || city,
          addr_state: validation.correctedAddress?.state || state,
          addr_zip: validation.correctedAddress?.zipCode || zip,
          addr_validated: validation.isValid ? '1' : '0',
        },
      }),
    };
  } catch (error) {
    console.error('Address validation error:', error);
    const fullAddress = `${line1}, ${line2 ? line2 + ', ' : ''}${city}, ${state} ${zip}`;
    const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

    return {
      type: 'actions',
      response: buildGather({
        prompt: `Your address is: ${fullAddress}. Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: nextNode?.node_key || 'checkout_address_confirm',
          addr_line1: line1, addr_line2: line2, addr_city: city, addr_state: state, addr_zip: zip, addr_validated: '0',
        },
      }),
    };
  }
});

registerHandler('address_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const addressId = ctx.sessionData.address_id;
  const useSaved = ctx.sessionData.use_saved;

  if (useSaved === 'pending') {
    if (digits === '1' && addressId) {
      return {
        type: 'actions',
        response: buildSay(
          'Address confirmed.',
          '/api/ivr/voice/gather',
          { call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_payment_choice', address_id: addressId }
        ),
      };
    }
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter your street address followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_address_line1' },
      }),
    };
  }

  if (digits === '2') {
    const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter your street address followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: retryNode?.node_key || 'checkout_address_line1' },
      }),
    };
  }

  const line1 = ctx.sessionData.addr_line1;
  const line2 = ctx.sessionData.addr_line2;
  const city = ctx.sessionData.addr_city;
  const state = ctx.sessionData.addr_state;
  const zip = ctx.sessionData.addr_zip;
  const validated = ctx.sessionData.addr_validated === '1';

  try {
    const { data: addr } = await supabaseAdmin
      .from('addresses')
      .insert({
        user_id: userId, address1: line1, address2: line2 || null,
        city, state, zip_code: zip, country: 'US', is_default: true, is_validated: validated,
      })
      .select()
      .single();

    if (!addr) throw new Error('Failed to save address');

    await supabaseAdmin.from('addresses').update({ is_default: false }).eq('user_id', userId).neq('id', addr.id);

    return {
      type: 'actions',
      response: buildSay(
        'Address saved.',
        '/api/ivr/voice/gather',
        { call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_payment_choice', address_id: addr.id }
      ),
    };
  } catch (error) {
    console.error('Address save error:', error);
    return { type: 'actions', response: buildHangup('Error saving your address. Please try again later.') };
  }
});

registerHandler('payment_choice', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;

  const { data: methods } = await supabaseAdmin
    .from('payment_methods')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });

  if (methods && methods.length > 0) {
    const defaultCard = methods[0];
    return {
      type: 'actions',
      response: buildGather({
        prompt: `Your saved card ending in ${defaultCard.card_last4}. Press 1 to use this card, or press 2 to enter a new card.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_summary',
          address_id: addressId, payment_method_id: defaultCard.id, use_saved_card: 'pending',
        },
      }),
    };
  }

  return {
    type: 'actions',
    response: buildSay(
      'Phone-based payment is temporarily unavailable. Please use the web app to add a payment method. Returning to the main menu.',
      '/api/ivr/voice/gather',
      { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
    ),
  };
});

registerHandler('order_summary', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const useSavedCard = ctx.sessionData.use_saved_card;
  const digits = ctx.req.body.digits;

  if (useSavedCard === 'pending' && digits === '2') {
    return {
      type: 'actions',
      response: buildSay(
        'Phone-based payment is temporarily unavailable. Please use the web app to add a payment method. Returning to the main menu.',
        '/api/ivr/voice/gather',
        { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
      ),
    };
  }

  const { data: cart } = await supabaseAdmin
    .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

  if (!cart) {
    return { type: 'actions', response: buildSay('Your cart is empty.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
  }

  const { data: items } = await supabaseAdmin
    .from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);

  if (!items || items.length === 0) {
    return { type: 'actions', response: buildSay('Your cart is empty.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
  }

  const subtotal = items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);

  return {
    type: 'actions',
    response: buildGather({
      prompt: `Your order total is ${formatCurrency(subtotal)}. Shipping and tax will be calculated at final confirmation. Press 1 to place the order, or press 2 to go back to your cart.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 15,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_confirm',
        address_id: addressId, payment_method_id: paymentMethodId,
      },
    }),
  };
});

/**
 * User pressed 1 to place order. Tell them to hold while we verify with Amazon.
 */
registerHandler('order_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;

  if (digits === '2') {
    return {
      type: 'actions',
      response: buildSay('Order cancelled. Returning to cart.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }),
    };
  }

  try {
    const { data: address } = await supabaseAdmin.from('addresses').select('*').eq('id', addressId).single();
    const { data: cart } = await supabaseAdmin.from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

    if (!address || !cart) throw new Error('Missing checkout data');

    const { data: cartItems } = await supabaseAdmin.from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);
    if (!cartItems || cartItems.length === 0) throw new Error('Empty cart');

    return {
      type: 'actions',
      response: buildSay(
        'Please hold while we verify your order with Amazon.',
        '/api/ivr/voice/gather',
        {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_final_confirm',
          address_id: addressId, payment_method_id: paymentMethodId,
        }
      ),
    };
  } catch (error) {
    console.error('Order confirmation error:', error);
    return { type: 'actions', response: buildHangup('We had trouble processing your order. Please try again later.') };
  }
});

/**
 * Creates the Rye multi-item intent synchronously, checks stock, and either
 * presents the final total or routes to stock issue resolution.
 */
registerHandler('final_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const digits = ctx.req.body.digits;

  if (digits === '2') {
    return {
      type: 'actions',
      response: buildSay('Order cancelled. Returning to cart.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }),
    };
  }

  try {
    const { data: address } = await supabaseAdmin.from('addresses').select('*').eq('id', addressId).single();
    const { data: paymentMethod } = await supabaseAdmin.from('payment_methods').select('*').eq('id', paymentMethodId).single();
    const { data: cart } = await supabaseAdmin.from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

    if (!address || !paymentMethod || !cart) throw new Error('Missing checkout data');

    const { data: cartItems } = await supabaseAdmin.from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);
    if (!cartItems || cartItems.length === 0) {
      return { type: 'actions', response: buildSay('Your cart is empty.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
    }

    let intentResult: IntentResult;
    try {
      intentResult = await createRyeIntent(cartItems, address);
    } catch (ryeError) {
      console.error('Rye intent creation failed:', ryeError);
      return { type: 'actions', response: buildHangup('We were unable to verify your order with Amazon. Please try again later.') };
    }

    if (!intentResult.success) {
      if (intentResult.stockFailures.length > 0) {
        const failuresJson = JSON.stringify(intentResult.stockFailures);
        return {
          type: 'actions',
          response: buildSay(
            'There is an issue with one or more items in your order.',
            '/api/ivr/voice/gather',
            {
              call_sid: ctx.callSid, user_id: userId,
              node_key: 'checkout_stock_issue',
              address_id: addressId, payment_method_id: paymentMethodId,
              stock_failures: failuresJson,
              stock_failure_idx: '0',
              retry_counts: '{}',
            }
          ),
        };
      }

      const reason = (intentResult.intent as any).failureReason?.code || 'unknown';
      console.error('Rye intent failed with non-stock reason:', reason);
      return { type: 'actions', response: buildHangup('We were unable to process your order. Please try again later.') };
    }

    const subtotal = cartItems.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
    const totalWithFees = subtotal + intentResult.shippingCents + intentResult.taxCents + intentResult.surchareCents;

    const shippingStr = intentResult.shippingCents > 0
      ? `Shipping is ${formatCurrency(intentResult.shippingCents)}. `
      : 'Shipping is free. ';
    const taxStr = intentResult.taxCents > 0
      ? `Tax is ${formatCurrency(intentResult.taxCents)}. `
      : '';

    return {
      type: 'actions',
      response: buildGather({
        prompt: `Your order total is ${formatCurrency(totalWithFees)}. ${shippingStr}${taxStr}Press 1 to confirm and pay, or press 2 to cancel.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 15,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_pay',
          address_id: addressId, payment_method_id: paymentMethodId,
          rye_intent_id: intentResult.intent.id,
          shipping_cents: String(intentResult.shippingCents),
          tax_cents: String(intentResult.taxCents),
          surcharge_cents: String(intentResult.surchareCents),
        },
      }),
    };
  } catch (error) {
    console.error('Final confirm error:', error);
    return { type: 'actions', response: buildHangup('We had trouble processing your order. Please try again later.') };
  }
});

/**
 * Handle stock issue resolution. Walk the caller through each failed item
 * one at a time by product name.
 */
registerHandler('stock_issue', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const failuresJson = ctx.sessionData.stock_failures;
  const failureIdx = parseInt(ctx.sessionData.stock_failure_idx || '0', 10);
  const retryCountsJson = ctx.sessionData.retry_counts || '{}';

  let failures: StockFailure[];
  let retryCounts: Record<string, number>;
  try {
    failures = JSON.parse(failuresJson);
    retryCounts = JSON.parse(retryCountsJson);
  } catch {
    return { type: 'actions', response: buildHangup('An error occurred processing your order. Please try again later.') };
  }

  if (failureIdx >= failures.length) {
    return {
      type: 'actions',
      response: buildSay(
        'Let me re-check your updated order with Amazon.',
        '/api/ivr/voice/gather',
        {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_final_confirm',
          address_id: addressId, payment_method_id: paymentMethodId,
        }
      ),
    };
  }

  const failure = failures[failureIdx];

  const { data: cart } = await supabaseAdmin
    .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

  if (!cart) {
    return { type: 'actions', response: buildSay('Your cart is empty. Returning to main menu.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
  }

  const { data: cartItems } = await supabaseAdmin
    .from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);

  if (!cartItems || cartItems.length === 0) {
    return { type: 'actions', response: buildSay('Your cart is empty. Returning to main menu.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
  }

  const affectedItem = findCartItemForFailure(failure, cartItems);
  if (!affectedItem) {
    return {
      type: 'actions',
      response: buildSay('This item has already been removed from your order.', '/api/ivr/voice/gather', {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'checkout_stock_issue',
        address_id: addressId, payment_method_id: paymentMethodId,
        stock_failures: failuresJson,
        stock_failure_idx: String(failureIdx + 1),
        retry_counts: JSON.stringify(retryCounts),
      }),
    };
  }

  const productName = getProductDisplayName(affectedItem.catalog_products);
  const productId = affectedItem.product_id;
  const retryCount = retryCounts[productId] || 0;

  if (failure.type === 'out_of_stock') {
    await supabaseAdmin.from('cart_items').delete().eq('id', affectedItem.id);

    const remainingItems = cartItems.filter((ci) => ci.id !== affectedItem.id);
    if (remainingItems.length === 0) {
      return {
        type: 'actions',
        response: buildSay(
          `Unfortunately, ${productName} is currently out of stock and has been removed from your order. Your cart is now empty. Returning to the main menu.`,
          '/api/ivr/voice/gather',
          { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
        ),
      };
    }

    return {
      type: 'actions',
      response: buildSay(
        `Unfortunately, ${productName} is currently out of stock and has been removed from your order.`,
        '/api/ivr/voice/gather',
        {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_stock_issue',
          address_id: addressId, payment_method_id: paymentMethodId,
          stock_failures: failuresJson,
          stock_failure_idx: String(failureIdx + 1),
          retry_counts: JSON.stringify(retryCounts),
        }
      ),
    };
  }

  // insufficient_stock — check retry limit
  if (retryCount >= MAX_STOCK_RETRIES_PER_ITEM) {
    await supabaseAdmin.from('cart_items').delete().eq('id', affectedItem.id);

    const remainingItems = cartItems.filter((ci) => ci.id !== affectedItem.id);
    if (remainingItems.length === 0) {
      return {
        type: 'actions',
        response: buildSay(
          `We were unable to process ${productName} after multiple attempts. It has been removed from your order. Your cart is now empty. Returning to the main menu.`,
          '/api/ivr/voice/gather',
          { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
        ),
      };
    }

    return {
      type: 'actions',
      response: buildSay(
        `We were unable to process ${productName} after multiple attempts. It has been removed from your order.`,
        '/api/ivr/voice/gather',
        {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_stock_issue',
          address_id: addressId, payment_method_id: paymentMethodId,
          stock_failures: failuresJson,
          stock_failure_idx: String(failureIdx + 1),
          retry_counts: JSON.stringify(retryCounts),
        }
      ),
    };
  }

  return {
    type: 'actions',
    response: buildGather({
      prompt: `${productName} does not have enough stock for the quantity of ${affectedItem.quantity} that you requested. Press 1 to enter a new quantity, or press 2 to remove it from your order.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 15,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'checkout_stock_new_qty',
        address_id: addressId, payment_method_id: paymentMethodId,
        stock_failures: failuresJson,
        stock_failure_idx: String(failureIdx),
        retry_counts: JSON.stringify(retryCounts),
        stock_item_id: affectedItem.id,
        stock_product_id: productId,
        stock_action: 'pending',
      },
    }),
  };
});

/**
 * Handle user response to stock issue: enter new qty or remove item.
 */
registerHandler('stock_new_qty', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const failuresJson = ctx.sessionData.stock_failures;
  const failureIdx = parseInt(ctx.sessionData.stock_failure_idx || '0', 10);
  const retryCountsJson = ctx.sessionData.retry_counts || '{}';
  const stockItemId = ctx.sessionData.stock_item_id;
  const stockProductId = ctx.sessionData.stock_product_id;
  const stockAction = ctx.sessionData.stock_action;
  const digits = ctx.req.body.digits;

  let retryCounts: Record<string, number>;
  try {
    retryCounts = JSON.parse(retryCountsJson);
  } catch {
    retryCounts = {};
  }

  const baseSessionData = {
    call_sid: ctx.callSid, user_id: userId,
    address_id: addressId, payment_method_id: paymentMethodId,
    stock_failures: failuresJson,
    stock_failure_idx: String(failureIdx),
    retry_counts: JSON.stringify(retryCounts),
  };

  if (stockAction === 'pending') {
    if (digits === '2') {
      await supabaseAdmin.from('cart_items').delete().eq('id', stockItemId);

      const { data: cart } = await supabaseAdmin
        .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

      if (cart) {
        const { data: remaining } = await supabaseAdmin
          .from('cart_items').select('id').eq('cart_id', cart.id);

        if (!remaining || remaining.length === 0) {
          return {
            type: 'actions',
            response: buildSay(
              'Item removed. Your cart is now empty. Returning to the main menu.',
              '/api/ivr/voice/gather',
              { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
            ),
          };
        }
      }

      return {
        type: 'actions',
        response: buildSay(
          'Item removed from your order.',
          '/api/ivr/voice/gather',
          { ...baseSessionData, node_key: 'checkout_stock_issue', stock_failure_idx: String(failureIdx + 1) }
        ),
      };
    }

    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter the new quantity followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          ...baseSessionData,
          node_key: 'checkout_stock_new_qty',
          stock_item_id: stockItemId,
          stock_product_id: stockProductId,
          stock_action: 'qty_entry',
        },
      }),
    };
  }

  // stock_action === 'qty_entry'
  const newQty = parseInt(digits || '', 10);

  if (!newQty || newQty <= 0) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter a valid quantity greater than zero, followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          ...baseSessionData,
          node_key: 'checkout_stock_new_qty',
          stock_item_id: stockItemId,
          stock_product_id: stockProductId,
          stock_action: 'qty_entry',
        },
      }),
    };
  }

  await supabaseAdmin
    .from('cart_items')
    .update({ quantity: newQty })
    .eq('id', stockItemId);

  retryCounts[stockProductId] = (retryCounts[stockProductId] || 0) + 1;

  return {
    type: 'actions',
    response: buildSay(
      `Quantity updated to ${newQty}.`,
      '/api/ivr/voice/gather',
      {
        ...baseSessionData,
        node_key: 'checkout_stock_issue',
        stock_failure_idx: String(failureIdx + 1),
        retry_counts: JSON.stringify(retryCounts),
      }
    ),
  };
});

/**
 * Final payment step — user confirmed the total with real shipping/tax.
 * Insert order in DB, then confirm with Rye (payment) in background.
 */
registerHandler('checkout_pay', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const ryeIntentId = ctx.sessionData.rye_intent_id;
  const shippingCents = parseInt(ctx.sessionData.shipping_cents || '0', 10);
  const taxCents = parseInt(ctx.sessionData.tax_cents || '0', 10);
  const surchargeCents = parseInt(ctx.sessionData.surcharge_cents || '0', 10);

  if (digits === '2') {
    return {
      type: 'actions',
      response: buildSay('Order cancelled. Returning to cart.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }),
    };
  }

  try {
    const { data: paymentMethod } = await supabaseAdmin.from('payment_methods').select('*').eq('id', paymentMethodId).single();
    const { data: cart } = await supabaseAdmin.from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

    if (!paymentMethod || !cart) throw new Error('Missing checkout data');

    const { data: cartItems } = await supabaseAdmin.from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);
    if (!cartItems || cartItems.length === 0) throw new Error('Empty cart');

    const subtotal = cartItems.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
    const totalCents = subtotal + shippingCents + taxCents + surchargeCents;

    const { data: order } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: userId, cart_id: cart.id, address_id: addressId, payment_method_id: paymentMethodId,
        rye_checkout_intent_id: ryeIntentId,
        status: 'pending', subtotal_cents: subtotal, shipping_cents: shippingCents,
        tax_cents: taxCents, total_cents: totalCents,
      })
      .select()
      .single();

    if (!order) throw new Error('Failed to create order');

    const orderItems = cartItems.map((ci) => ({
      order_id: order.id, product_id: ci.product_id, voicex_id: ci.voicex_id,
      product_name: getProductDisplayName(ci.catalog_products),
      quantity: ci.quantity, unit_price_cents: ci.unit_price_cents,
      amazon_price_cents: ci.amazon_price_cents, markup_percent: ci.markup_percent,
    }));

    await supabaseAdmin.from('order_items').insert(orderItems);
    await supabaseAdmin.from('order_events').insert({ order_id: order.id, status: 'pending', source: 'system', details: { action: 'order_created' } });
    await supabaseAdmin.from('carts').update({ status: 'checked_out' }).eq('id', cart.id);

    confirmAndFinalizeOrder(order.id, ryeIntentId, paymentMethod, cartItems).catch((err) =>
      console.error('Rye confirm background error:', err)
    );

    return {
      type: 'actions',
      response: buildSay(
        `Your order has been placed! Your order number is ${order.id.slice(-6).toUpperCase()}. You will receive updates on the status of your order. Thank you for shopping with VoiceX!`,
        '/api/ivr/voice/gather',
        { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
      ),
    };
  } catch (error) {
    console.error('Order placement error:', error);
    return { type: 'actions', response: buildHangup('We had trouble placing your order. Please try again later.') };
  }
});

async function confirmAndFinalizeOrder(
  orderId: string,
  intentId: string,
  paymentMethod: any,
  cartItems: any[]
) {
  try {
    await supabaseAdmin.from('order_events').insert({
      order_id: orderId, status: 'processing', source: 'system',
      details: { action: 'rye_checkout_started', rye_intent_id: intentId },
    });
    await supabaseAdmin.from('orders').update({ status: 'processing' }).eq('id', orderId);

    const completed = await confirmRyeIntent(intentId, paymentMethod);
    const finalStatus = completed.state === 'completed' ? 'completed' : 'failed';

    await supabaseAdmin.from('orders').update({ status: finalStatus }).eq('id', orderId);
    await supabaseAdmin.from('order_events').insert({
      order_id: orderId, status: finalStatus, source: 'system',
      details: {
        rye_intent_id: intentId,
        rye_state: completed.state,
        failure_reason: completed.failureReason || null,
      },
    });

    if (finalStatus === 'completed') {
      for (const item of cartItems) {
        await supabaseAdmin.rpc('increment_product_sold', {
          p_product_id: item.product_id,
          p_qty: item.quantity,
        });
      }
    }
  } catch (error) {
    console.error('Rye confirm/finalize error:', error);
    await supabaseAdmin.from('orders').update({ status: 'failed' }).eq('id', orderId);
    await supabaseAdmin.from('order_events').insert({
      order_id: orderId, status: 'failed', source: 'system',
      details: { error: String(error), rye_intent_id: intentId },
    });
  }
}
