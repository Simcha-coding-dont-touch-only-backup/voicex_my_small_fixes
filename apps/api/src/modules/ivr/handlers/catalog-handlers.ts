import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildSay, formatCurrency } from '../../teltech/teltech-builder.js';
import { normalizeInput } from '../../teltech/input-normalizer.js';
import { getProductDisplayName, getProductPriceCents } from '@voicex/shared';
import { ivrRuntime } from '../runtime.js';
import { fetchAmazonProductReviews } from '../../../lib/rye.js';

registerHandler('lookup_product', async (ctx) => {
  const digits = ctx.req.body.digits;
  const userId = ctx.sessionData.user_id;

  if (!digits) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: ctx.node.prompt_text || 'Please enter the catalog number followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
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
      type: 'actions',
      response: buildGather({
        prompt: `Product with catalog number ${digits.split('').join(' ')} was not found. Please enter a different catalog number.`,
        actionPath: '/api/ivr/voice/gather',
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

  return {
    type: 'actions',
    response: buildGather({
      prompt: `${displayName}, priced at ${priceStr}. ${nextNode?.prompt_text || 'Press 1 to Add to Cart. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product. Press star for Main Menu.'}`,
      actionPath: '/api/ivr/voice/gather',
      timeout: 10,
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
  const digits = ctx.req.body.digits;

  const intents = ctx.node.config.intents || [];
  const input = normalizeInput(digits, intents);

  if (input.matchedIntent === 'more_details') {
    const { data: product } = await supabaseAdmin
      .from('catalog_products')
      .select('*')
      .eq('id', productId)
      .single();

    const description = product?.voice_description || product?.amazon_description || 'No description available.';

    return {
      type: 'actions',
      response: buildGather({
        prompt: `${description}. Press 1 to Add to Cart. Press 4 for Another Product. Press star for Main Menu.`,
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          product_id: productId, voicex_id: voicexId,
        },
      }),
    };
  }

  if (input.matchedIntent === 'reviews') {
    const { data: product } = await supabaseAdmin
      .from('catalog_products')
      .select('amazon_asin')
      .eq('id', productId)
      .single();

    let reviewPrompt = 'Review information is not available for this product.';
    if (product?.amazon_asin) {
      const reviews = await fetchAmazonProductReviews(product.amazon_asin);
      if (reviews && reviews.ratingsTotal > 0) {
        reviewPrompt = `This product has a rating of ${reviews.rating} based on ${reviews.ratingsTotal.toLocaleString()} reviews.`;
      }
    }

    return {
      type: 'actions',
      response: buildGather({
        prompt: `${reviewPrompt} Press 1 to Add to Cart. Press 4 for Another Product. Press star for Main Menu.`,
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
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
          type: 'actions',
          response: buildGather({
            prompt: targetNode.prompt_text || 'Please continue.',
            actionPath: '/api/ivr/voice/gather',
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
    type: 'actions',
    response: buildGather({
      prompt: ctx.node.prompt_text || 'Press 1 to Add to Cart. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product. Press star for Main Menu.',
      actionPath: '/api/ivr/voice/gather',
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
  const digits = ctx.req.body.digits;

  const qty = parseInt(digits || '0', 10);
  if (!qty || qty <= 0) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter a valid quantity.',
        actionPath: '/api/ivr/voice/gather',
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
    type: 'actions',
    response: buildGather({
      prompt: `You entered a quantity of ${qty}. Press 1 to confirm, or press 2 to re-enter.`,
      actionPath: '/api/ivr/voice/gather',
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
  const digits = ctx.req.body.digits;

  if (digits === '2') {
    const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Enter the quantity.',
        actionPath: '/api/ivr/voice/gather',
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

    return {
      type: 'actions',
      response: buildGather({
        prompt: `${qty} of ${displayName} has been added to your cart. ${nextNode?.prompt_text || 'Press 1 for Another Product. Press 2 for Checkout. Press star for Main Menu.'}`,
        actionPath: '/api/ivr/voice/gather',
        timeout: 8,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: nextNode?.node_key || 'catalog_after_add',
        },
      }),
    };
  } catch (error) {
    console.error('Add to cart error:', error);
    return {
      type: 'actions',
      response: buildSay(
        'There was an error adding the product to your cart. Please try again.',
        `/api/ivr/voice/gather?node_key=catalog_input&user_id=${userId}&call_sid=${ctx.callSid}`
      ),
    };
  }
});
