import type { Request, Response } from 'express';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildGather, buildSay, buildHangup, formatCurrency } from '../../teltech/teltech-builder.js';
import { validateAddress } from '../../../lib/google-address.js';
import { createRyeIntent, confirmRyeIntent, findCartItemForFailure } from '../../../lib/rye-checkout.js';
import type { StockFailure, IntentResult } from '../../../lib/rye-checkout.js';
import { getProductDisplayName } from '@voicex/shared';

const MAX_STOCK_RETRIES_PER_ITEM = 3;

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
    case 'checkout_final_confirm':
      return handleFinalConfirm(req, res, userId, callSid);
    case 'checkout_stock_issue':
      return handleStockIssue(req, res, userId, callSid);
    case 'checkout_stock_new_qty':
      return handleStockNewQty(req, res, userId, callSid);
    case 'checkout_pay':
      return handleCheckoutPayStep(req, res, userId, callSid);
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

    res.json(
      buildGather({
        prompt: `Your saved address is: ${addrStr}. Press 1 to use this address, or press 2 to enter a new address.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
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
    res.json(
      buildGather({
        prompt: 'Please enter your street number and name followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
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
  const digits = req.body.digits;
  const line1 = digits || '';

  if (!line1.trim()) {
    res.json(
      buildGather({
        prompt: 'Please enter your street address.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'checkout_address_line1' },
      })
    );
    return;
  }

  res.json(
    buildGather({
      prompt: 'Enter apartment or unit number, or press pound to skip.',
      actionPath: '/api/ivr/voice/gather',
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
  const digits = req.body.digits;
  const line2 = digits || '';

  res.json(
    buildGather({
      prompt: 'Enter your city name.',
      actionPath: '/api/ivr/voice/gather',
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
  const city = req.body.digits || '';

  if (!city.trim()) {
    res.json(
      buildGather({
        prompt: 'Please enter your city name.',
        actionPath: '/api/ivr/voice/gather',
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

  res.json(
    buildGather({
      prompt: 'Enter your 2-letter state code.',
      actionPath: '/api/ivr/voice/gather',
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
  const state = (req.body.digits || '').trim().toUpperCase().slice(0, 2);

  if (!state) {
    res.json(
      buildGather({
        prompt: 'Please enter your state code.',
        actionPath: '/api/ivr/voice/gather',
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

  res.json(
    buildGather({
      prompt: 'Enter your 5-digit ZIP code.',
      actionPath: '/api/ivr/voice/gather',
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
  const zip = req.body.digits || '';

  if (zip.length !== 5) {
    res.json(
      buildGather({
        prompt: 'Please enter a valid 5-digit ZIP code.',
        actionPath: '/api/ivr/voice/gather',
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

    res.json(
      buildGather({
        prompt: `Your address is: ${fullAddress}. ${validation.isValid ? '' : 'Note: we detected some issues with this address. '}Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/ivr/voice/gather',
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

    res.json(
      buildGather({
        prompt: `Your address is: ${fullAddress}. Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/ivr/voice/gather',
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
  const digits = req.body.digits;
  const addressId = req.query.address_id as string;
  const useSaved = req.query.use_saved as string;

  if (useSaved === 'pending') {
    if (digits === '1' && addressId) {
      res.json(
        buildSay(
          'Address confirmed.',
          '/api/ivr/voice/gather',
          { step: 'checkout_payment_choice', user_id: userId, call_sid: callSid, address_id: addressId }
        )
      );
      return;
    }
    res.json(
      buildGather({
        prompt: 'Please enter your street address followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 15,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'checkout_address_line1' },
      })
    );
    return;
  }

  if (digits === '2') {
    res.json(
      buildGather({
        prompt: 'Please enter your street address followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
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

    res.json(
      buildSay(
        'Address saved.',
        '/api/ivr/voice/gather',
        { step: 'checkout_payment_choice', user_id: userId, call_sid: callSid, address_id: addr.id }
      )
    );
  } catch (error) {
    console.error('Address save error:', error);
    res.json(
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
    res.json(
      buildGather({
        prompt: `Your saved card ending in ${defaultCard.card_last4}. Press 1 to use this card, or press 2 to enter a new card.`,
        actionPath: '/api/ivr/voice/gather',
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
    res.json(
      buildSay(
        'Phone-based payment is temporarily unavailable. Please use the web app to add a payment method. Returning to the main menu.',
        '/api/ivr/voice/gather',
        { step: 'main_menu', user_id: userId, call_sid: callSid }
      )
    );
  }
}

async function handleOrderSummary(
  req: Request, res: Response, userId: string, callSid: string
) {
  const addressId = req.query.address_id as string;
  const paymentMethodId = req.query.payment_method_id as string;
  const useSavedCard = req.query.use_saved_card as string;
  const digits = req.body.digits;

  if (useSavedCard === 'pending' && digits === '2') {
    res.json(
      buildSay(
        'Phone-based payment is temporarily unavailable. Please use the web app to add a payment method. Returning to the main menu.',
        '/api/ivr/voice/gather',
        { step: 'main_menu', user_id: userId, call_sid: callSid }
      )
    );
    return;
  }

  const { data: cart } = await supabaseAdmin
    .from('carts')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (!cart) {
    res.json(
      buildSay('Your cart is empty.', '/api/ivr/voice/gather', { step: 'main_menu', user_id: userId, call_sid: callSid })
    );
    return;
  }

  const { data: items } = await supabaseAdmin
    .from('cart_items')
    .select('*, catalog_products(*)')
    .eq('cart_id', cart.id);

  if (!items || items.length === 0) {
    res.json(
      buildSay('Your cart is empty.', '/api/ivr/voice/gather', { step: 'main_menu', user_id: userId, call_sid: callSid })
    );
    return;
  }

  const subtotal = items.reduce(
    (sum, i) => sum + i.unit_price_cents * i.quantity, 0
  );

  res.json(
    buildGather({
      prompt: `Your order total is ${formatCurrency(subtotal)}. Shipping and tax will be calculated at final confirmation. Press 1 to place the order, or press 2 to go back to your cart.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 15,
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

/**
 * User pressed 1 to place order. We now create the Rye intent synchronously
 * to validate stock and get real shipping/tax before confirming.
 */
async function handleOrderConfirm(
  req: Request, res: Response, userId: string, callSid: string
) {
  const digits = req.body.digits;
  const addressId = req.query.address_id as string;
  const paymentMethodId = req.query.payment_method_id as string;

  if (digits === '2') {
    res.json(
      buildSay(
        'Order cancelled. Returning to cart.',
        '/api/ivr/voice/gather',
        { step: 'cart_menu', user_id: userId, call_sid: callSid }
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

    const { data: cart } = await supabaseAdmin
      .from('carts')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!address || !cart) {
      throw new Error('Missing checkout data');
    }

    const { data: cartItems } = await supabaseAdmin
      .from('cart_items')
      .select('*, catalog_products(*)')
      .eq('cart_id', cart.id);

    if (!cartItems || cartItems.length === 0) {
      throw new Error('Empty cart');
    }

    res.json(
      buildSay(
        'Please hold while we verify your order with Amazon.',
        '/api/ivr/voice/gather',
        {
          step: 'checkout_final_confirm',
          user_id: userId,
          call_sid: callSid,
          address_id: addressId,
          payment_method_id: paymentMethodId,
        }
      )
    );
  } catch (error) {
    console.error('Order confirmation error:', error);
    res.json(
      buildHangup('We had trouble processing your order. Please try again later.')
    );
  }
}

/**
 * Creates the Rye intent synchronously, checks stock, and either
 * presents the final total or routes to stock issue resolution.
 */
async function handleFinalConfirm(
  req: Request, res: Response, userId: string, callSid: string
) {
  const addressId = req.query.address_id as string;
  const paymentMethodId = req.query.payment_method_id as string;
  const digits = req.body.digits;

  // If returning from a previous final confirm prompt where user pressed 2 to cancel
  if (digits === '2') {
    res.json(
      buildSay(
        'Order cancelled. Returning to cart.',
        '/api/ivr/voice/gather',
        { step: 'cart_menu', user_id: userId, call_sid: callSid }
      )
    );
    return;
  }

  try {
    const { data: address } = await supabaseAdmin
      .from('addresses').select('*').eq('id', addressId).single();
    const { data: paymentMethod } = await supabaseAdmin
      .from('payment_methods').select('*').eq('id', paymentMethodId).single();
    const { data: cart } = await supabaseAdmin
      .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

    if (!address || !paymentMethod || !cart) throw new Error('Missing checkout data');

    const { data: cartItems } = await supabaseAdmin
      .from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);

    if (!cartItems || cartItems.length === 0) {
      res.json(
        buildSay('Your cart is empty.', '/api/ivr/voice/gather', { step: 'main_menu', user_id: userId, call_sid: callSid })
      );
      return;
    }

    let intentResult: IntentResult;
    try {
      intentResult = await createRyeIntent(cartItems, address);
    } catch (ryeError) {
      console.error('Rye intent creation failed:', ryeError);
      res.json(
        buildHangup('We were unable to verify your order with Amazon. Please try again later.')
      );
      return;
    }

    if (!intentResult.success) {
      if (intentResult.stockFailures.length > 0) {
        // Serialize failures to session data and start resolving them one by one
        const failuresJson = JSON.stringify(intentResult.stockFailures);
        res.json(
          buildSay(
            'There is an issue with one or more items in your order.',
            '/api/ivr/voice/gather',
            {
              step: 'checkout_stock_issue',
              user_id: userId,
              call_sid: callSid,
              address_id: addressId,
              payment_method_id: paymentMethodId,
              stock_failures: failuresJson,
              stock_failure_idx: '0',
              retry_counts: '{}',
            }
          )
        );
        return;
      }

      // Non-stock failure
      const reason = intentResult.intent.failureReason?.code || 'unknown';
      console.error('Rye intent failed with non-stock reason:', reason);
      res.json(
        buildHangup('We were unable to process your order. Please try again later.')
      );
      return;
    }

    // Intent succeeded — present final total with real shipping/tax
    const subtotal = cartItems.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
    const totalWithFees = subtotal + intentResult.shippingCents + intentResult.taxCents + intentResult.surchareCents;

    const shippingStr = intentResult.shippingCents > 0
      ? `Shipping is ${formatCurrency(intentResult.shippingCents)}. `
      : 'Shipping is free. ';
    const taxStr = intentResult.taxCents > 0
      ? `Tax is ${formatCurrency(intentResult.taxCents)}. `
      : '';

    res.json(
      buildGather({
        prompt: `Your order total is ${formatCurrency(totalWithFees)}. ${shippingStr}${taxStr}Press 1 to confirm and pay, or press 2 to cancel.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 15,
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'checkout_pay',
          address_id: addressId,
          payment_method_id: paymentMethodId,
          rye_intent_id: intentResult.intent.id,
          shipping_cents: String(intentResult.shippingCents),
          tax_cents: String(intentResult.taxCents),
          surcharge_cents: String(intentResult.surchareCents),
        },
      })
    );
  } catch (error) {
    console.error('Final confirm error:', error);
    res.json(
      buildHangup('We had trouble processing your order. Please try again later.')
    );
  }
}

/**
 * Handle stock issue resolution. Walk the caller through each failed item
 * one at a time by product name.
 */
async function handleStockIssue(
  req: Request, res: Response, userId: string, callSid: string
) {
  const addressId = req.query.address_id as string;
  const paymentMethodId = req.query.payment_method_id as string;
  const failuresJson = req.query.stock_failures as string;
  const failureIdx = parseInt(req.query.stock_failure_idx as string || '0', 10);
  const retryCountsJson = req.query.retry_counts as string || '{}';
  const digits = req.body.digits;

  let failures: StockFailure[];
  let retryCounts: Record<string, number>;
  try {
    failures = JSON.parse(failuresJson);
    retryCounts = JSON.parse(retryCountsJson);
  } catch {
    res.json(buildHangup('An error occurred processing your order. Please try again later.'));
    return;
  }

  if (failureIdx >= failures.length) {
    // All failures resolved — retry the intent with updated cart
    res.json(
      buildSay(
        'Let me re-check your updated order with Amazon.',
        '/api/ivr/voice/gather',
        {
          step: 'checkout_final_confirm',
          user_id: userId,
          call_sid: callSid,
          address_id: addressId,
          payment_method_id: paymentMethodId,
        }
      )
    );
    return;
  }

  const failure = failures[failureIdx];

  const { data: cart } = await supabaseAdmin
    .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

  if (!cart) {
    res.json(buildSay('Your cart is empty. Returning to main menu.', '/api/ivr/voice/gather', { step: 'main_menu', user_id: userId, call_sid: callSid }));
    return;
  }

  const { data: cartItems } = await supabaseAdmin
    .from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);

  if (!cartItems || cartItems.length === 0) {
    res.json(buildSay('Your cart is empty. Returning to main menu.', '/api/ivr/voice/gather', { step: 'main_menu', user_id: userId, call_sid: callSid }));
    return;
  }

  const affectedItem = findCartItemForFailure(failure, cartItems);
  if (!affectedItem) {
    res.json(
      buildSay(
        'This item has already been removed from your order.',
        '/api/ivr/voice/gather',
        {
          step: 'checkout_stock_issue',
          user_id: userId,
          call_sid: callSid,
          address_id: addressId,
          payment_method_id: paymentMethodId,
          stock_failures: failuresJson,
          stock_failure_idx: String(failureIdx + 1),
          retry_counts: JSON.stringify(retryCounts),
        }
      )
    );
    return;
  }

  const productName = getProductDisplayName(affectedItem.catalog_products);
  const productId = affectedItem.product_id;
  const retryCount = retryCounts[productId] || 0;

  if (failure.type === 'out_of_stock') {
    // Auto-remove and inform caller
    await supabaseAdmin.from('cart_items').delete().eq('id', affectedItem.id);

    const remainingItems = cartItems.filter((ci) => ci.id !== affectedItem.id);
    if (remainingItems.length === 0) {
      res.json(
        buildSay(
          `Unfortunately, ${productName} is currently out of stock and has been removed from your order. Your cart is now empty. Returning to the main menu.`,
          '/api/ivr/voice/gather',
          { step: 'main_menu', user_id: userId, call_sid: callSid }
        )
      );
      return;
    }

    res.json(
      buildSay(
        `Unfortunately, ${productName} is currently out of stock and has been removed from your order.`,
        '/api/ivr/voice/gather',
        {
          step: 'checkout_stock_issue',
          user_id: userId,
          call_sid: callSid,
          address_id: addressId,
          payment_method_id: paymentMethodId,
          stock_failures: failuresJson,
          stock_failure_idx: String(failureIdx + 1),
          retry_counts: JSON.stringify(retryCounts),
        }
      )
    );
    return;
  }

  // insufficient_stock — check retry limit
  if (retryCount >= MAX_STOCK_RETRIES_PER_ITEM) {
    await supabaseAdmin.from('cart_items').delete().eq('id', affectedItem.id);

    const remainingItems = cartItems.filter((ci) => ci.id !== affectedItem.id);
    if (remainingItems.length === 0) {
      res.json(
        buildSay(
          `We were unable to process ${productName} after multiple attempts. It has been removed from your order. Your cart is now empty. Returning to the main menu.`,
          '/api/ivr/voice/gather',
          { step: 'main_menu', user_id: userId, call_sid: callSid }
        )
      );
      return;
    }

    res.json(
      buildSay(
        `We were unable to process ${productName} after multiple attempts. It has been removed from your order.`,
        '/api/ivr/voice/gather',
        {
          step: 'checkout_stock_issue',
          user_id: userId,
          call_sid: callSid,
          address_id: addressId,
          payment_method_id: paymentMethodId,
          stock_failures: failuresJson,
          stock_failure_idx: String(failureIdx + 1),
          retry_counts: JSON.stringify(retryCounts),
        }
      )
    );
    return;
  }

  // Ask user to enter a new quantity or remove
  res.json(
    buildGather({
      prompt: `${productName} does not have enough stock for the quantity of ${affectedItem.quantity} that you requested. Press 1 to enter a new quantity, or press 2 to remove it from your order.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 15,
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'checkout_stock_new_qty',
        address_id: addressId,
        payment_method_id: paymentMethodId,
        stock_failures: failuresJson,
        stock_failure_idx: String(failureIdx),
        retry_counts: JSON.stringify(retryCounts),
        stock_item_id: affectedItem.id,
        stock_product_id: productId,
        stock_action: 'pending',
      },
    })
  );
}

/**
 * Handle the user's response to a stock issue: enter new qty or remove item.
 */
async function handleStockNewQty(
  req: Request, res: Response, userId: string, callSid: string
) {
  const addressId = req.query.address_id as string;
  const paymentMethodId = req.query.payment_method_id as string;
  const failuresJson = req.query.stock_failures as string;
  const failureIdx = parseInt(req.query.stock_failure_idx as string || '0', 10);
  const retryCountsJson = req.query.retry_counts as string || '{}';
  const stockItemId = req.query.stock_item_id as string;
  const stockProductId = req.query.stock_product_id as string;
  const stockAction = req.query.stock_action as string;
  const digits = req.body.digits;

  let retryCounts: Record<string, number>;
  try {
    retryCounts = JSON.parse(retryCountsJson);
  } catch {
    retryCounts = {};
  }

  const baseSessionData = {
    call_sid: callSid,
    user_id: userId,
    address_id: addressId,
    payment_method_id: paymentMethodId,
    stock_failures: failuresJson,
    stock_failure_idx: String(failureIdx),
    retry_counts: JSON.stringify(retryCounts),
  };

  if (stockAction === 'pending') {
    // User chose: 1 = enter new qty, 2 = remove
    if (digits === '2') {
      await supabaseAdmin.from('cart_items').delete().eq('id', stockItemId);

      const { data: cart } = await supabaseAdmin
        .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

      if (cart) {
        const { data: remaining } = await supabaseAdmin
          .from('cart_items').select('id').eq('cart_id', cart.id);

        if (!remaining || remaining.length === 0) {
          res.json(
            buildSay(
              'Item removed. Your cart is now empty. Returning to the main menu.',
              '/api/ivr/voice/gather',
              { step: 'main_menu', user_id: userId, call_sid: callSid }
            )
          );
          return;
        }
      }

      res.json(
        buildSay(
          'Item removed from your order.',
          '/api/ivr/voice/gather',
          {
            step: 'checkout_stock_issue',
            ...baseSessionData,
            stock_failure_idx: String(failureIdx + 1),
          }
        )
      );
      return;
    }

    // Press 1 — prompt for new quantity
    res.json(
      buildGather({
        prompt: 'Please enter the new quantity followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          ...baseSessionData,
          step: 'checkout_stock_new_qty',
          stock_item_id: stockItemId,
          stock_product_id: stockProductId,
          stock_action: 'qty_entry',
        },
      })
    );
    return;
  }

  // stock_action === 'qty_entry' — user entered a new quantity
  const newQty = parseInt(digits || '', 10);

  if (!newQty || newQty <= 0) {
    res.json(
      buildGather({
        prompt: 'Please enter a valid quantity greater than zero, followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          ...baseSessionData,
          step: 'checkout_stock_new_qty',
          stock_item_id: stockItemId,
          stock_product_id: stockProductId,
          stock_action: 'qty_entry',
        },
      })
    );
    return;
  }

  // Update cart item quantity
  await supabaseAdmin
    .from('cart_items')
    .update({ quantity: newQty })
    .eq('id', stockItemId);

  // Increment retry count for this product
  retryCounts[stockProductId] = (retryCounts[stockProductId] || 0) + 1;

  // Advance to next failure (or re-attempt intent if all resolved)
  res.json(
    buildSay(
      `Quantity updated to ${newQty}.`,
      '/api/ivr/voice/gather',
      {
        step: 'checkout_stock_issue',
        ...baseSessionData,
        stock_failure_idx: String(failureIdx + 1),
        retry_counts: JSON.stringify(retryCounts),
      }
    )
  );
}

async function handleCheckoutPayStep(
  req: Request, res: Response, userId: string, callSid: string
) {
  const digits = req.body.digits;
  const addressId = req.query.address_id as string;
  const paymentMethodId = req.query.payment_method_id as string;
  const ryeIntentId = req.query.rye_intent_id as string;
  const shippingCents = parseInt(req.query.shipping_cents as string || '0', 10);
  const taxCents = parseInt(req.query.tax_cents as string || '0', 10);
  const surchargeCents = parseInt(req.query.surcharge_cents as string || '0', 10);

  if (digits === '2') {
    res.json(
      buildSay(
        'Order cancelled. Returning to cart.',
        '/api/ivr/voice/gather',
        { step: 'cart_menu', user_id: userId, call_sid: callSid }
      )
    );
    return;
  }

  try {
    const { data: paymentMethod } = await supabaseAdmin
      .from('payment_methods').select('*').eq('id', paymentMethodId).single();
    const { data: cart } = await supabaseAdmin
      .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

    if (!paymentMethod || !cart) throw new Error('Missing checkout data');

    const { data: cartItems } = await supabaseAdmin
      .from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);

    if (!cartItems || cartItems.length === 0) throw new Error('Empty cart');

    const subtotal = cartItems.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
    const totalCents = subtotal + shippingCents + taxCents + surchargeCents;

    // Insert order with real costs from Rye
    const { data: order } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: userId,
        cart_id: cart.id,
        address_id: addressId,
        payment_method_id: paymentMethodId,
        rye_checkout_intent_id: ryeIntentId,
        status: 'pending',
        subtotal_cents: subtotal,
        shipping_cents: shippingCents,
        tax_cents: taxCents,
        total_cents: totalCents,
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
      order_id: order.id, status: 'pending', source: 'system', details: { action: 'order_created' },
    });
    await supabaseAdmin.from('carts').update({ status: 'checked_out' }).eq('id', cart.id);

    // Confirm with Rye (payment) — run in background since stock is already validated
    confirmAndFinalizeOrder(order.id, ryeIntentId, paymentMethod, cartItems).catch((err) =>
      console.error('Rye confirm background error:', err)
    );

    res.json(
      buildSay(
        `Your order has been placed! Your order number is ${order.id.slice(-6).toUpperCase()}. You will receive updates on the status of your order. Thank you for shopping with VoiceX!`,
        '/api/ivr/voice/gather',
        { step: 'main_menu', user_id: userId, call_sid: callSid }
      )
    );
  } catch (error) {
    console.error('Order placement error:', error);
    res.json(
      buildHangup('We had trouble placing your order. Please try again later.')
    );
  }
}

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

    const completed = await confirmRyeIntent(intentId);
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
