import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildSay, buildHangup, formatCurrency } from '../../twilio/twiml-builder.js';
import { validateAddress } from '../../../lib/google-address.js';
import { ryeClient } from '../../../lib/rye.js';
import { getProductDisplayName } from '@voicex/shared';
import { ivrRuntime } from '../runtime.js';
import { config } from '../../../config.js';

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
      type: 'twiml',
      twiml: buildGather({
        prompt: `Your saved address is: ${addrStr}. Press 1 to use this address, or press 2 to enter a new address.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        numDigits: 1,
        timeout: 10,
        hints: ['use this address', 'new address'],
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
    type: 'twiml',
    twiml: buildGather({
      prompt: nextNode?.prompt_text || 'Please enter your street number and name. Say it followed by the pound key.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      timeout: 15,
      finishOnKey: '#',
      sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: nextNode?.node_key || 'checkout_address_line1' },
    }),
  };
});

registerHandler('address_line1', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const speechResult = ctx.req.body.SpeechResult;
  const digits = ctx.req.body.Digits;
  const line1 = speechResult || digits || '';

  if (!line1.trim()) {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Please say or enter your street address.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'twiml',
    twiml: buildGather({
      prompt: nextNode?.prompt_text || 'Enter apartment or unit number, or press pound to skip.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
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
  const speechResult = ctx.req.body.SpeechResult;
  const digits = ctx.req.body.Digits;
  const line2 = speechResult || digits || '';

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'twiml',
    twiml: buildGather({
      prompt: nextNode?.prompt_text || 'Say or enter your city name.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
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
  const speechResult = ctx.req.body.SpeechResult;
  const city = speechResult || ctx.req.body.Digits || '';

  if (!city.trim()) {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Please say your city name.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'speech',
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
    type: 'twiml',
    twiml: buildGather({
      prompt: nextNode?.prompt_text || 'Say or enter your 2-letter state code.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
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
  const speechResult = ctx.req.body.SpeechResult;
  const state = (speechResult || ctx.req.body.Digits || '').trim().toUpperCase().slice(0, 2);

  if (!state) {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Please say your state.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'speech',
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
    type: 'twiml',
    twiml: buildGather({
      prompt: nextNode?.prompt_text || 'Enter your 5-digit ZIP code.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
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
  const zip = ctx.req.body.Digits || '';

  if (zip.length !== 5) {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Please enter a valid 5-digit ZIP code.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
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
      type: 'twiml',
      twiml: buildGather({
        prompt: `Your address is: ${fullAddress}. ${validation.isValid ? '' : 'Note: we detected some issues with this address. '}Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
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
      type: 'twiml',
      twiml: buildGather({
        prompt: `Your address is: ${fullAddress}. Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
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
  const digits = ctx.req.body.Digits;
  const addressId = ctx.sessionData.address_id;
  const useSaved = ctx.sessionData.use_saved;

  if (useSaved === 'pending') {
    if (digits === '1' && addressId) {
      return {
        type: 'twiml',
        twiml: buildSay(
          'Address confirmed.',
          `/api/twilio/voice/gather?node_key=checkout_payment_choice&user_id=${userId}&call_sid=${ctx.callSid}&address_id=${addressId}`
        ),
      };
    }
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Please say your street address followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_address_line1' },
      }),
    };
  }

  if (digits === '2') {
    const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Please say your street address followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
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
      type: 'twiml',
      twiml: buildSay(
        'Address saved.',
        `/api/twilio/voice/gather?node_key=checkout_payment_choice&user_id=${userId}&call_sid=${ctx.callSid}&address_id=${addr.id}`
      ),
    };
  } catch (error) {
    console.error('Address save error:', error);
    return { type: 'twiml', twiml: buildHangup('Error saving your address. Please try again later.') };
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
      type: 'twiml',
      twiml: buildGather({
        prompt: `Your saved card ending in ${defaultCard.card_last4}. Press 1 to use this card, or press 2 to enter a new card.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
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

  const { TwiML: TwiMLModule } = await import('../../../lib/twilio.js');
  const response = new TwiMLModule.VoiceResponse();
  response.say({ voice: 'Polly.Matthew' }, 'Please enter your credit card information.');
  (response as any).pay({
    chargeAmount: '0',
    paymentConnector: 'Default',
    action: `${config.apiBaseUrl}/api/twilio/voice/payment?user_id=${userId}&call_sid=${ctx.callSid}&address_id=${addressId}`,
    method: 'POST',
    tokenType: 'reusable',
    postalCode: false as any,
  });

  return { type: 'twiml', twiml: response.toString() };
});

registerHandler('order_summary', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const useSavedCard = ctx.sessionData.use_saved_card;
  const digits = ctx.req.body.Digits;

  if (useSavedCard === 'pending' && digits === '2') {
    const { TwiML: TwiMLModule } = await import('../../../lib/twilio.js');
    const response = new TwiMLModule.VoiceResponse();
    response.say({ voice: 'Polly.Matthew' }, 'Please enter your credit card information.');
    (response as any).pay({
      chargeAmount: '0',
      paymentConnector: 'Default',
      action: `${config.apiBaseUrl}/api/twilio/voice/payment?user_id=${userId}&call_sid=${ctx.callSid}&address_id=${addressId}`,
      method: 'POST',
      tokenType: 'reusable',
      postalCode: false as any,
    });
    return { type: 'twiml', twiml: response.toString() };
  }

  const { data: cart } = await supabaseAdmin
    .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

  if (!cart) {
    return { type: 'twiml', twiml: buildSay('Your cart is empty.', `/api/twilio/voice/gather?node_key=main_menu&user_id=${userId}&call_sid=${ctx.callSid}`) };
  }

  const { data: items } = await supabaseAdmin
    .from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);

  if (!items || items.length === 0) {
    return { type: 'twiml', twiml: buildSay('Your cart is empty.', `/api/twilio/voice/gather?node_key=main_menu&user_id=${userId}&call_sid=${ctx.callSid}`) };
  }

  const subtotal = items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);

  return {
    type: 'twiml',
    twiml: buildGather({
      prompt: `Your order total is ${formatCurrency(subtotal)}. Shipping and tax will be calculated at final confirmation. Press 1 to place the order, or press 2 to go back to your cart.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      numDigits: 1,
      timeout: 15,
      hints: ['place order', 'cancel', 'go back'],
      sessionData: {
        call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_confirm',
        address_id: addressId, payment_method_id: paymentMethodId,
      },
    }),
  };
});

registerHandler('order_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.Digits;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;

  if (digits === '2') {
    return {
      type: 'twiml',
      twiml: buildSay('Order cancelled. Returning to cart.', `/api/twilio/voice/gather?node_key=cart_menu&user_id=${userId}&call_sid=${ctx.callSid}`),
    };
  }

  try {
    const { data: address } = await supabaseAdmin.from('addresses').select('*').eq('id', addressId).single();
    const { data: paymentMethod } = await supabaseAdmin.from('payment_methods').select('*').eq('id', paymentMethodId).single();
    const { data: cart } = await supabaseAdmin.from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

    if (!address || !paymentMethod || !cart) throw new Error('Missing checkout data');

    const { data: cartItems } = await supabaseAdmin.from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);
    if (!cartItems || cartItems.length === 0) throw new Error('Empty cart');

    const subtotal = cartItems.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);

    const { data: order } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: userId, cart_id: cart.id, address_id: addressId, payment_method_id: paymentMethodId,
        status: 'pending', subtotal_cents: subtotal, shipping_cents: 0, tax_cents: 0, total_cents: subtotal,
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

    processRyeCheckout(order.id, cartItems, address, paymentMethod).catch((err) =>
      console.error('Rye checkout background error:', err)
    );

    return {
      type: 'twiml',
      twiml: buildSay(
        `Your order has been placed! Your order number is ${order.id.slice(-6).toUpperCase()}. You will receive updates on the status of your order. Thank you for shopping with VoiceX!`,
        `/api/twilio/voice/gather?node_key=main_menu&user_id=${userId}&call_sid=${ctx.callSid}`
      ),
    };
  } catch (error) {
    console.error('Order placement error:', error);
    return { type: 'twiml', twiml: buildHangup('We had trouble placing your order. Please try again later.') };
  }
});

async function processRyeCheckout(orderId: string, cartItems: any[], address: any, paymentMethod: any) {
  try {
    await supabaseAdmin.from('order_events').insert({ order_id: orderId, status: 'processing', source: 'system', details: { action: 'rye_checkout_started' } });
    await supabaseAdmin.from('orders').update({ status: 'processing' }).eq('id', orderId);

    for (const item of cartItems) {
      const product = item.catalog_products;
      if (!product?.amazon_url) continue;

      try {
        const intent = await ryeClient.checkoutIntents.createAndPoll({
          buyer: {
            firstName: 'VoiceX', lastName: 'Customer', email: 'orders@voicex.com', phone: '0000000000',
            address1: address.address1, address2: address.address2 || undefined,
            city: address.city, province: address.state, postalCode: address.zip_code, country: address.country || 'US',
          },
          productUrl: product.amazon_url,
          quantity: item.quantity,
        });

        if (intent.offer) {
          const shippingCents = intent.offer.shipping?.availableOptions?.[0]?.cost?.amountSubunits || 0;
          const taxCents = intent.offer.cost?.tax?.amountSubunits || 0;
          await supabaseAdmin.from('orders').update({
            shipping_cents: shippingCents, tax_cents: taxCents,
            total_cents: item.unit_price_cents * item.quantity + shippingCents + taxCents,
            rye_checkout_intent_id: intent.id,
          }).eq('id', orderId);
        }

        const completed = await ryeClient.checkoutIntents.confirmAndPoll(intent.id, {
          paymentMethod: { stripeToken: paymentMethod.stripe_token, type: 'stripe_token' },
        });

        const finalStatus = completed.state === 'completed' ? 'completed' : 'failed';
        await supabaseAdmin.from('orders').update({ status: finalStatus }).eq('id', orderId);
        await supabaseAdmin.from('order_events').insert({
          order_id: orderId, status: finalStatus, source: 'system',
          details: { rye_intent_id: intent.id, rye_state: completed.state, failure_reason: (completed as any).failureReason || null },
        });

        if (finalStatus === 'completed') {
          await supabaseAdmin.rpc('increment_product_sold', { p_product_id: item.product_id, p_qty: item.quantity });
        }
      } catch (ryeError) {
        console.error(`Rye checkout failed for product ${product.voicex_id}:`, ryeError);
        await supabaseAdmin.from('order_events').insert({
          order_id: orderId, status: 'failed', source: 'system',
          details: { error: String(ryeError), product_id: item.product_id },
        });
      }
    }
  } catch (error) {
    console.error('Rye checkout process error:', error);
    await supabaseAdmin.from('orders').update({ status: 'failed' }).eq('id', orderId);
  }
}
