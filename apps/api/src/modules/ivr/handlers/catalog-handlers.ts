import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildSay, formatCurrency } from '../../twilio/twiml-builder.js';
import { normalizeInput } from '../../twilio/speech-normalizer.js';
import { getProductDisplayName, getProductPriceCents } from '@voicex/shared';
import { ivrRuntime } from '../runtime.js';

registerHandler('lookup_product', async (ctx) => {
  const digits = ctx.req.body.Digits;
  const userId = ctx.sessionData.user_id;

  if (!digits) {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: ctx.node.prompt_text || 'Please enter the catalog number followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const { data: product } = await supabaseAdmin
    .from('catalog_products')
    .select('*')
    .eq('voicex_id', digits)
    .eq('is_active', true)
    .single();

  if (!product) {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: `Product with catalog number ${digits.split('').join(' ')} was not found. Please enter a different catalog number.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('is_whitelisted')
    .eq('id', userId)
    .single();

  const { data: settings } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'default_markup_percent')
    .single();

  const markupPercent = settings ? parseFloat(settings.value) : 15;
  const isWhitelisted = user?.is_whitelisted || false;
  const displayName = getProductDisplayName(product);
  const priceCents = getProductPriceCents(product, markupPercent, isWhitelisted);
  const priceStr = priceCents ? formatCurrency(priceCents) : 'price unavailable';

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'found');
  const intents = nextNode?.config.intents || [];
  const hints = intents.flatMap((i: any) => i.speech_phrases);

  return {
    type: 'twiml',
    twiml: buildGather({
      prompt: `${displayName}, priced at ${priceStr}. ${nextNode?.prompt_text || 'Press 1 to Add to Cart. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product. Press star for Main Menu.'}`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      timeout: 10,
      hints,
      sessionData: {
        call_sid: ctx.callSid,
        user_id: userId,
        node_key: nextNode?.node_key || 'catalog_action',
        product_id: product.id,
        voicex_id: product.voicex_id,
      },
    }),
  };
});

registerHandler('catalog_action', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const productId = ctx.sessionData.product_id;
  const voicexId = ctx.sessionData.voicex_id;
  const digits = ctx.req.body.Digits;
  const speechResult = ctx.req.body.SpeechResult;
  const confidence = ctx.req.body.Confidence;

  const intents = ctx.node.config.intents || [];
  const input = normalizeInput(digits, speechResult, confidence, intents);

  if (input.matchedIntent === 'more_details') {
    const { data: product } = await supabaseAdmin
      .from('catalog_products')
      .select('*')
      .eq('id', productId)
      .single();

    const description = product?.voice_description || product?.amazon_description || 'No description available.';

    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: `${description}. Press 1 to Add to Cart. Press 4 for Another Product. Press star for Main Menu.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 10,
        hints: ['add to cart', 'another product', 'main menu'],
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          product_id: productId, voicex_id: voicexId,
        },
      }),
    };
  }

  if (input.matchedIntent === 'reviews') {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Reviews are currently being loaded from Amazon. This feature will be available shortly. Press 1 to Add to Cart. Press 4 for Another Product. Press star for Main Menu.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 10,
        hints: ['add to cart', 'another product', 'main menu'],
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          product_id: productId, voicex_id: voicexId,
        },
      }),
    };
  }

  if (input.matchedIntent) {
    const targetNodeKey = intents.find((i: any) => i.name === input.matchedIntent)?.target_node_key;
    if (targetNodeKey) {
      const targetNode = await ivrRuntime.getNodeByKey(ctx.flowVersionId, targetNodeKey);
      if (targetNode) {
        return {
          type: 'twiml',
          twiml: buildGather({
            prompt: targetNode.prompt_text || 'Please continue.',
            actionPath: '/api/twilio/voice/gather',
            inputType: (targetNode.config.input_type as any)?.replace('_', ' ') || 'dtmf speech',
            numDigits: targetNode.config.num_digits,
            timeout: targetNode.config.timeout_seconds || 10,
            finishOnKey: targetNode.config.finish_on_key,
            sessionData: {
              call_sid: ctx.callSid, user_id: userId, node_key: targetNode.node_key,
              product_id: productId, voicex_id: voicexId,
            },
          }),
        };
      }
    }
  }

  return {
    type: 'twiml',
    twiml: buildGather({
      prompt: ctx.node.prompt_text || 'Press 1 to Add to Cart. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product. Press star for Main Menu.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      timeout: 8,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
        product_id: productId, voicex_id: voicexId,
      },
    }),
  };
});

registerHandler('enter_qty', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const productId = ctx.sessionData.product_id;
  const voicexId = ctx.sessionData.voicex_id;
  const digits = ctx.req.body.Digits;

  const qty = parseInt(digits || '0', 10);
  if (!qty || qty <= 0) {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Please enter a valid quantity.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          product_id: productId, voicex_id: voicexId,
        },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'twiml',
    twiml: buildGather({
      prompt: `You entered a quantity of ${qty}. Press 1 to confirm, or press 2 to re-enter.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
      numDigits: 1,
      timeout: 10,
      finishOnKey: '',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'catalog_qty_confirm',
        product_id: productId, voicex_id: voicexId, qty: qty.toString(),
      },
    }),
  };
});

registerHandler('confirm_qty', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const productId = ctx.sessionData.product_id;
  const voicexId = ctx.sessionData.voicex_id;
  const qty = parseInt(ctx.sessionData.qty, 10);
  const digits = ctx.req.body.Digits;

  if (digits === '2') {
    const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Enter the quantity.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: retryNode?.node_key || 'catalog_qty',
          product_id: productId, voicex_id: voicexId,
        },
      }),
    };
  }

  try {
    const { data: product } = await supabaseAdmin
      .from('catalog_products')
      .select('*')
      .eq('id', productId)
      .single();

    if (!product) throw new Error('Product not found');

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('is_whitelisted')
      .eq('id', userId)
      .single();

    const { data: settings } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'default_markup_percent')
      .single();

    const markupPercent = settings ? parseFloat(settings.value) : 15;
    const isWhitelisted = user?.is_whitelisted || false;
    const priceCents = getProductPriceCents(product, markupPercent, isWhitelisted) || 0;

    let { data: cart } = await supabaseAdmin
      .from('carts')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!cart) {
      const { data: newCart } = await supabaseAdmin
        .from('carts')
        .insert({ user_id: userId, status: 'active' })
        .select()
        .single();
      cart = newCart;
    }

    if (!cart) throw new Error('Failed to create cart');

    const { data: existingItem } = await supabaseAdmin
      .from('cart_items')
      .select('*')
      .eq('cart_id', cart.id)
      .eq('product_id', productId)
      .single();

    if (existingItem) {
      await supabaseAdmin
        .from('cart_items')
        .update({ quantity: existingItem.quantity + qty })
        .eq('id', existingItem.id);
    } else {
      await supabaseAdmin.from('cart_items').insert({
        cart_id: cart.id,
        product_id: productId,
        voicex_id: voicexId,
        quantity: qty,
        unit_price_cents: priceCents,
        amazon_price_cents: product.amazon_price_cents || 0,
        markup_percent: isWhitelisted ? 0 : markupPercent,
      });
    }

    const displayName = getProductDisplayName(product);
    const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'confirmed');
    const nextIntents = nextNode?.config.intents || [];
    const hints = nextIntents.flatMap((i: any) => i.speech_phrases);

    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: `${qty} of ${displayName} has been added to your cart. ${nextNode?.prompt_text || 'Press 1 for Another Product. Press 2 for Checkout. Press star for Main Menu.'}`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 8,
        hints,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: nextNode?.node_key || 'catalog_after_add',
        },
      }),
    };
  } catch (error) {
    console.error('Add to cart error:', error);
    return {
      type: 'twiml',
      twiml: buildSay(
        'There was an error adding the product to your cart. Please try again.',
        `/api/twilio/voice/gather?node_key=catalog_input&user_id=${userId}&call_sid=${ctx.callSid}`
      ),
    };
  }
});
