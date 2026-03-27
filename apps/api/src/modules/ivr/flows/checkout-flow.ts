import type { Request, Response } from 'express';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildGather, buildSay, buildPayGather, buildHangup, formatCurrency } from '../../twilio/twiml-builder.js';
import { validateAddress } from '../../../lib/google-address.js';
import { ryeClient } from '../../../lib/rye.js';
import { getProductDisplayName } from '@voicex/shared';
import { buildMainMenuTwiml } from './pin-flow.js';

export async function handleCheckoutFlow(req: Request, res: Response) {
  const step = req.query.step as string;
  const userId = req.query.user_id as string;
  const callSid = req.query.call_sid as string;

  switch (step) {
    case 'checkout_address_choice':
      return handleAddressChoice(req, res, userId, callSid);
    case 'checkout_address_line1':
      return handleAddressLine1(req, res, userId, callSid);
    case 'checkout_address_line2':
      return handleAddressLine2(req, res, userId, callSid);
    case 'checkout_address_city':
      return handleAddressCity(req, res, userId, callSid);
    case 'checkout_address_state':
      return handleAddressState(req, res, userId, callSid);
    case 'checkout_address_zip':
      return handleAddressZip(req, res, userId, callSid);
    case 'checkout_address_confirm':
      return handleAddressConfirm(req, res, userId, callSid);
    case 'checkout_payment_choice':
      return handlePaymentChoice(req, res, userId, callSid);
    case 'checkout_summary':
      return handleOrderSummary(req, res, userId, callSid);
    case 'checkout_confirm':
      return handleOrderConfirm(req, res, userId, callSid);
  }
}

async function handleAddressChoice(
  req: Request, res: Response, userId: string, callSid: string
) {
  const { data: addresses } = await supabaseAdmin
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });

  if (addresses && addresses.length > 0) {
    const defaultAddr = addresses[0];
    const addrStr = `${defaultAddr.address1}, ${defaultAddr.address2 || ''}, ${defaultAddr.city}, ${defaultAddr.state} ${defaultAddr.zip_code}`.replace(/, ,/g, ',');

    res.type('text/xml').send(
      buildGather({
        prompt: `Your saved address is: ${addrStr}. Press 1 to use this address, or press 2 to enter a new address.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        numDigits: 1,
        timeout: 10,
        hints: ['use this address', 'new address'],
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'checkout_address_confirm',
          address_id: defaultAddr.id,
          use_saved: 'pending',
        },
      })
    );
  } else {
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please enter your street number and name. Say it followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'checkout_address_line1' },
      })
    );
  }
}

async function handleAddressLine1(
  req: Request, res: Response, userId: string, callSid: string
) {
  const speechResult = req.body.SpeechResult;
  const digits = req.body.Digits;
  const line1 = speechResult || digits || '';

  if (!line1.trim()) {
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please say or enter your street address.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'checkout_address_line1' },
      })
    );
    return;
  }

  res.type('text/xml').send(
    buildGather({
      prompt: 'Enter apartment or unit number, or press pound to skip.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      timeout: 10,
      finishOnKey: '#',
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'checkout_address_line2',
        addr_line1: line1.trim(),
      },
    })
  );
}

async function handleAddressLine2(
  req: Request, res: Response, userId: string, callSid: string
) {
  const line1 = req.query.addr_line1 as string;
  const speechResult = req.body.SpeechResult;
  const digits = req.body.Digits;
  const line2 = speechResult || digits || '';

  res.type('text/xml').send(
    buildGather({
      prompt: 'Say or enter your city name.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      timeout: 15,
      finishOnKey: '#',
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'checkout_address_city',
        addr_line1: line1,
        addr_line2: line2.trim(),
      },
    })
  );
}

async function handleAddressCity(
  req: Request, res: Response, userId: string, callSid: string
) {
  const line1 = req.query.addr_line1 as string;
  const line2 = req.query.addr_line2 as string;
  const speechResult = req.body.SpeechResult;
  const city = speechResult || req.body.Digits || '';

  if (!city.trim()) {
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please say your city name.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'speech',
        timeout: 10,
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'checkout_address_city',
          addr_line1: line1,
          addr_line2: line2,
        },
      })
    );
    return;
  }

  res.type('text/xml').send(
    buildGather({
      prompt: 'Say or enter your 2-letter state code.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      timeout: 10,
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'checkout_address_state',
        addr_line1: line1,
        addr_line2: line2,
        addr_city: city.trim(),
      },
    })
  );
}

async function handleAddressState(
  req: Request, res: Response, userId: string, callSid: string
) {
  const line1 = req.query.addr_line1 as string;
  const line2 = req.query.addr_line2 as string;
  const city = req.query.addr_city as string;
  const speechResult = req.body.SpeechResult;
  const state = (speechResult || req.body.Digits || '').trim().toUpperCase().slice(0, 2);

  if (!state) {
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please say your state.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'speech',
        timeout: 10,
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'checkout_address_state',
          addr_line1: line1,
          addr_line2: line2,
          addr_city: city,
        },
      })
    );
    return;
  }

  res.type('text/xml').send(
    buildGather({
      prompt: 'Enter your 5-digit ZIP code.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
      numDigits: 5,
      timeout: 10,
      finishOnKey: '',
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'checkout_address_zip',
        addr_line1: line1,
        addr_line2: line2,
        addr_city: city,
        addr_state: state,
      },
    })
  );
}

async function handleAddressZip(
  req: Request, res: Response, userId: string, callSid: string
) {
  const line1 = req.query.addr_line1 as string;
  const line2 = req.query.addr_line2 as string;
  const city = req.query.addr_city as string;
  const state = req.query.addr_state as string;
  const zip = req.body.Digits || '';

  if (zip.length !== 5) {
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please enter a valid 5-digit ZIP code.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        numDigits: 5,
        timeout: 10,
        finishOnKey: '',
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'checkout_address_zip',
          addr_line1: line1,
          addr_line2: line2,
          addr_city: city,
          addr_state: state,
        },
      })
    );
    return;
  }

  try {
    const validation = await validateAddress({
      address1: line1,
      address2: line2 || undefined,
      city,
      state,
      zipCode: zip,
    });

    const fullAddress = validation.formattedAddress || `${line1}, ${line2 ? line2 + ', ' : ''}${city}, ${state} ${zip}`;

    res.type('text/xml').send(
      buildGather({
        prompt: `Your address is: ${fullAddress}. ${validation.isValid ? '' : 'Note: we detected some issues with this address. '}Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'checkout_address_confirm',
          addr_line1: validation.correctedAddress?.address1 || line1,
          addr_line2: line2,
          addr_city: validation.correctedAddress?.city || city,
          addr_state: validation.correctedAddress?.state || state,
          addr_zip: validation.correctedAddress?.zipCode || zip,
          addr_validated: validation.isValid ? '1' : '0',
        },
      })
    );
  } catch (error) {
    console.error('Address validation error:', error);
    const fullAddress = `${line1}, ${line2 ? line2 + ', ' : ''}${city}, ${state} ${zip}`;

    res.type('text/xml').send(
      buildGather({
        prompt: `Your address is: ${fullAddress}. Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'checkout_address_confirm',
          addr_line1: line1,
          addr_line2: line2,
          addr_city: city,
          addr_state: state,
          addr_zip: zip,
          addr_validated: '0',
        },
      })
    );
  }
}

async function handleAddressConfirm(
  req: Request, res: Response, userId: string, callSid: string
) {
  const digits = req.body.Digits;
  const addressId = req.query.address_id as string;
  const useSaved = req.query.use_saved as string;

  if (useSaved === 'pending') {
    if (digits === '1' && addressId) {
      res.type('text/xml').send(
        buildSay(
          'Address confirmed.',
          `/api/twilio/voice/gather?step=checkout_payment_choice&user_id=${userId}&call_sid=${callSid}&address_id=${addressId}`
        )
      );
      return;
    }
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please say your street address followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'checkout_address_line1' },
      })
    );
    return;
  }

  if (digits === '2') {
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please say your street address followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'checkout_address_line1' },
      })
    );
    return;
  }

  const line1 = req.query.addr_line1 as string;
  const line2 = req.query.addr_line2 as string;
  const city = req.query.addr_city as string;
  const state = req.query.addr_state as string;
  const zip = req.query.addr_zip as string;
  const validated = req.query.addr_validated === '1';

  try {
    const { data: addr } = await supabaseAdmin
      .from('addresses')
      .insert({
        user_id: userId,
        address1: line1,
        address2: line2 || null,
        city,
        state,
        zip_code: zip,
        country: 'US',
        is_default: true,
        is_validated: validated,
      })
      .select()
      .single();

    if (!addr) throw new Error('Failed to save address');

    await supabaseAdmin
      .from('addresses')
      .update({ is_default: false })
      .eq('user_id', userId)
      .neq('id', addr.id);

    res.type('text/xml').send(
      buildSay(
        'Address saved.',
        `/api/twilio/voice/gather?step=checkout_payment_choice&user_id=${userId}&call_sid=${callSid}&address_id=${addr.id}`
      )
    );
  } catch (error) {
    console.error('Address save error:', error);
    res.type('text/xml').send(
      buildHangup('Error saving your address. Please try again later.')
    );
  }
}

async function handlePaymentChoice(
  req: Request, res: Response, userId: string, callSid: string
) {
  const addressId = req.query.address_id as string;

  const { data: methods } = await supabaseAdmin
    .from('payment_methods')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });

  if (methods && methods.length > 0) {
    const defaultCard = methods[0];
    res.type('text/xml').send(
      buildGather({
        prompt: `Your saved card ending in ${defaultCard.card_last4}. Press 1 to use this card, or press 2 to enter a new card.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'checkout_summary',
          address_id: addressId,
          payment_method_id: defaultCard.id,
          use_saved_card: 'pending',
        },
      })
    );
  } else {
    const { TwiML: TwiMLModule } = await import('../../../lib/twilio.js');
    const response = new TwiMLModule.VoiceResponse();
    response.say({ voice: 'Polly.Matthew' }, 'Please enter your credit card information.');

    const payAttrs: any = {
      chargeAmount: '0',
      paymentConnector: 'Default',
      action: `${(await import('../../../config.js')).config.apiBaseUrl}/api/twilio/voice/payment?user_id=${userId}&call_sid=${callSid}&address_id=${addressId}`,
      method: 'POST',
      tokenType: 'reusable',
      postalCode: false as any,
    };
    (response as any).pay(payAttrs);

    res.type('text/xml').send(response.toString());
  }
}

async function handleOrderSummary(
  req: Request, res: Response, userId: string, callSid: string
) {
  const addressId = req.query.address_id as string;
  const paymentMethodId = req.query.payment_method_id as string;
  const useSavedCard = req.query.use_saved_card as string;
  const digits = req.body.Digits;

  if (useSavedCard === 'pending' && digits === '2') {
    const { TwiML: TwiMLModule } = await import('../../../lib/twilio.js');
    const response = new TwiMLModule.VoiceResponse();
    response.say({ voice: 'Polly.Matthew' }, 'Please enter your credit card information.');
    const payAttrs: any = {
      chargeAmount: '0',
      paymentConnector: 'Default',
      action: `${(await import('../../../config.js')).config.apiBaseUrl}/api/twilio/voice/payment?user_id=${userId}&call_sid=${callSid}&address_id=${addressId}`,
      method: 'POST',
      tokenType: 'reusable',
      postalCode: false as any,
    };
    (response as any).pay(payAttrs);
    res.type('text/xml').send(response.toString());
    return;
  }

  const { data: cart } = await supabaseAdmin
    .from('carts')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (!cart) {
    res.type('text/xml').send(
      buildSay('Your cart is empty.', `/api/twilio/voice/gather?step=main_menu&user_id=${userId}&call_sid=${callSid}`)
    );
    return;
  }

  const { data: items } = await supabaseAdmin
    .from('cart_items')
    .select('*, catalog_products(*)')
    .eq('cart_id', cart.id);

  if (!items || items.length === 0) {
    res.type('text/xml').send(
      buildSay('Your cart is empty.', `/api/twilio/voice/gather?step=main_menu&user_id=${userId}&call_sid=${callSid}`)
    );
    return;
  }

  const subtotal = items.reduce(
    (sum, i) => sum + i.unit_price_cents * i.quantity, 0
  );

  res.type('text/xml').send(
    buildGather({
      prompt: `Your order total is ${formatCurrency(subtotal)}. Shipping and tax will be calculated at final confirmation. Press 1 to place the order, or press 2 to go back to your cart.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      numDigits: 1,
      timeout: 15,
      hints: ['place order', 'cancel', 'go back'],
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'checkout_confirm',
        address_id: addressId,
        payment_method_id: paymentMethodId,
      },
    })
  );
}

async function handleOrderConfirm(
  req: Request, res: Response, userId: string, callSid: string
) {
  const digits = req.body.Digits;
  const addressId = req.query.address_id as string;
  const paymentMethodId = req.query.payment_method_id as string;

  if (digits === '2') {
    res.type('text/xml').send(
      buildSay(
        'Order cancelled. Returning to cart.',
        `/api/twilio/voice/gather?step=cart_menu&user_id=${userId}&call_sid=${callSid}`
      )
    );
    return;
  }

  try {
    const { data: address } = await supabaseAdmin
      .from('addresses')
      .select('*')
      .eq('id', addressId)
      .single();

    const { data: paymentMethod } = await supabaseAdmin
      .from('payment_methods')
      .select('*')
      .eq('id', paymentMethodId)
      .single();

    const { data: cart } = await supabaseAdmin
      .from('carts')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!address || !paymentMethod || !cart) {
      throw new Error('Missing checkout data');
    }

    const { data: cartItems } = await supabaseAdmin
      .from('cart_items')
      .select('*, catalog_products(*)')
      .eq('cart_id', cart.id);

    if (!cartItems || cartItems.length === 0) {
      throw new Error('Empty cart');
    }

    const subtotal = cartItems.reduce(
      (sum, i) => sum + i.unit_price_cents * i.quantity, 0
    );

    const { data: order } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: userId,
        cart_id: cart.id,
        address_id: addressId,
        payment_method_id: paymentMethodId,
        status: 'pending',
        subtotal_cents: subtotal,
        shipping_cents: 0,
        tax_cents: 0,
        total_cents: subtotal,
      })
      .select()
      .single();

    if (!order) throw new Error('Failed to create order');

    const orderItems = cartItems.map((ci) => ({
      order_id: order.id,
      product_id: ci.product_id,
      voicex_id: ci.voicex_id,
      product_name: getProductDisplayName(ci.catalog_products),
      quantity: ci.quantity,
      unit_price_cents: ci.unit_price_cents,
      amazon_price_cents: ci.amazon_price_cents,
      markup_percent: ci.markup_percent,
    }));

    await supabaseAdmin.from('order_items').insert(orderItems);

    await supabaseAdmin.from('order_events').insert({
      order_id: order.id,
      status: 'pending',
      source: 'system',
      details: { action: 'order_created' },
    });

    await supabaseAdmin
      .from('carts')
      .update({ status: 'checked_out' })
      .eq('id', cart.id);

    processRyeCheckout(order.id, cartItems, address, paymentMethod).catch((err) =>
      console.error('Rye checkout background error:', err)
    );

    res.type('text/xml').send(
      buildSay(
        `Your order has been placed! Your order number is ${order.id.slice(-6).toUpperCase()}. You will receive updates on the status of your order. Thank you for shopping with VoiceX!`,
        `/api/twilio/voice/gather?step=main_menu&user_id=${userId}&call_sid=${callSid}`
      )
    );
  } catch (error) {
    console.error('Order placement error:', error);
    res.type('text/xml').send(
      buildHangup('We had trouble placing your order. Please try again later.')
    );
  }
}

async function processRyeCheckout(
  orderId: string,
  cartItems: any[],
  address: any,
  paymentMethod: any
) {
  try {
    await supabaseAdmin.from('order_events').insert({
      order_id: orderId,
      status: 'processing',
      source: 'system',
      details: { action: 'rye_checkout_started' },
    });

    await supabaseAdmin
      .from('orders')
      .update({ status: 'processing' })
      .eq('id', orderId);

    for (const item of cartItems) {
      const product = item.catalog_products;
      if (!product?.amazon_url) continue;

      try {
        const intent = await ryeClient.checkoutIntents.createAndPoll({
          buyer: {
            firstName: 'VoiceX',
            lastName: 'Customer',
            email: 'orders@voicex.com',
            phone: '0000000000',
            address1: address.address1,
            address2: address.address2 || undefined,
            city: address.city,
            province: address.state,
            postalCode: address.zip_code,
            country: address.country || 'US',
          },
          productUrl: product.amazon_url,
          quantity: item.quantity,
        });

        if (intent.offer) {
          const shippingCents = intent.offer.shipping?.availableOptions?.[0]?.cost?.amountSubunits || 0;
          const taxCents = intent.offer.cost?.tax?.amountSubunits || 0;

          await supabaseAdmin.from('orders').update({
            shipping_cents: shippingCents,
            tax_cents: taxCents,
            total_cents: item.unit_price_cents * item.quantity + shippingCents + taxCents,
            rye_checkout_intent_id: intent.id,
          }).eq('id', orderId);
        }

        const completed = await ryeClient.checkoutIntents.confirmAndPoll(intent.id, {
          paymentMethod: {
            stripeToken: paymentMethod.stripe_token,
            type: 'stripe_token',
          },
        });

        const finalStatus = completed.state === 'completed' ? 'completed' : 'failed';

        await supabaseAdmin.from('orders').update({ status: finalStatus }).eq('id', orderId);

        await supabaseAdmin.from('order_events').insert({
          order_id: orderId,
          status: finalStatus,
          source: 'system',
          details: {
            rye_intent_id: intent.id,
            rye_state: completed.state,
            failure_reason: (completed as any).failureReason || null,
          },
        });

        if (finalStatus === 'completed') {
          await supabaseAdmin.rpc('increment_product_sold', {
            p_product_id: item.product_id,
            p_qty: item.quantity,
          });
        }
      } catch (ryeError) {
        console.error(`Rye checkout failed for product ${product.voicex_id}:`, ryeError);
        await supabaseAdmin.from('order_events').insert({
          order_id: orderId,
          status: 'failed',
          source: 'system',
          details: { error: String(ryeError), product_id: item.product_id },
        });
      }
    }
  } catch (error) {
    console.error('Rye checkout process error:', error);
    await supabaseAdmin.from('orders').update({ status: 'failed' }).eq('id', orderId);
  }
}
