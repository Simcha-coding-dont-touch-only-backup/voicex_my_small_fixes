import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildGatherFromNode, buildSay, formatCurrency } from '../../teltech/teltech-builder.js';
import { normalizeInput, normalizeVoicexId } from '../../teltech/input-normalizer.js';
import { getProductDisplayName, getProductPriceCents } from '@voicex/shared';
import { ivrRuntime } from '../runtime.js';
import { fetchAmazonProductReviews } from '../../../lib/rainforest.js';

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

  const lookupId = normalizeVoicexId(digits);
  const { data: product } = await supabaseAdmin
    .from('catalog_products')
    .select('*')
    .eq('voicex_id', lookupId)
    .eq('is_active', true)
    .is('deleted_at', null)
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

  if (nextNode) {
    return {
      type: 'actions',
      response: buildGatherFromNode(nextNode, {
        call_sid: ctx.callSid,
        user_id: userId,
        product_id: product.id,
        voicex_id: product.voicex_id,
      }, {
        prompt: `${displayName}, priced at ${priceStr}. ${nextNode.prompt_text || 'Press 1 to Add to Cart. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product. Press star for Main Menu.'}`,
      }),
    };
  }

  return {
    type: 'actions',
    response: buildGather({
      prompt: `${displayName}, priced at ${priceStr}. Press 1 to Add to Cart. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product. Press star for Main Menu.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      sessionData: {
        call_sid: ctx.callSid,
        user_id: userId,
        node_key: 'catalog_action',
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
      .is('deleted_at', null)
      .single();

    const description = product?.voice_description || product?.amazon_description || 'No description available.';

    return {
      type: 'actions',
      response: buildGather({
        prompt: `${description}. Press 1 to Add to Cart. Press 4 for Another Product. Press star for Main Menu.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: ctx.node.config.num_digits,
        timeout: ctx.node.config.timeout_seconds || 10,
        finishOnKey: ctx.node.config.finish_on_key,
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
      .select('amazon_asin, amazon_star_rating, amazon_ratings_total')
      .eq('id', productId)
      .is('deleted_at', null)
      .single();

    let reviewPrompt = 'Review information is not available for this product.';

    let starRating = product?.amazon_star_rating;
    let ratingsTotal = product?.amazon_ratings_total;

    if (product?.amazon_asin) {
      const reviews = await fetchAmazonProductReviews(product.amazon_asin);
      if (reviews) {
        starRating = reviews.rating ?? starRating;
        ratingsTotal = reviews.ratingsTotal;
        supabaseAdmin
          .from('catalog_products')
          .update({ amazon_star_rating: starRating, amazon_ratings_total: ratingsTotal })
          .eq('id', productId)
          .then();
      }
    }

    if (ratingsTotal && ratingsTotal > 0) {
      if (starRating) {
        reviewPrompt = `This product has a rating of ${starRating} based on ${ratingsTotal.toLocaleString()} reviews.`;
      } else {
        reviewPrompt = `This product has ${ratingsTotal.toLocaleString()} reviews.`;
      }
    }

    return {
      type: 'actions',
      response: buildGather({
        prompt: `${reviewPrompt} Press 1 to Add to Cart. Press 4 for Another Product. Press star for Main Menu.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: ctx.node.config.num_digits,
        timeout: ctx.node.config.timeout_seconds || 10,
        finishOnKey: ctx.node.config.finish_on_key,
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
        if (targetNode.node_type === 'action' && targetNode.handler_name) {
          return {
            type: 'actions',
            response: buildSay(
              targetNode.prompt_text || 'Processing.',
              '/api/ivr/voice/gather',
              {
                call_sid: ctx.callSid, user_id: userId, node_key: targetNode.node_key,
                product_id: productId, voicex_id: voicexId,
              }
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
      numDigits: ctx.node.config.num_digits,
      timeout: ctx.node.config.timeout_seconds || 8,
      finishOnKey: ctx.node.config.finish_on_key,
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

  if (nextNode) {
    return {
      type: 'actions',
      response: buildGatherFromNode(nextNode, {
        call_sid: ctx.callSid, user_id: userId,
        product_id: productId, voicex_id: voicexId, qty: qty.toString(),
      }, {
        prompt: `You entered a quantity of ${qty}. Press 1 to confirm, or press 2 to re-enter.`,
      }),
    };
  }

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
        node_key: 'catalog_qty_confirm',
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
      .is('deleted_at', null)
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
        local_price_cents: product.local_price_cents ?? null,
        markup_percent: isWhitelisted ? 0 : markupPercent,
      });
    }

    const displayName = getProductDisplayName(product);
    const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'confirmed');

    if (nextNode) {
      return {
        type: 'actions',
        response: buildGatherFromNode(nextNode, {
          call_sid: ctx.callSid, user_id: userId,
        }, {
          prompt: `${qty} of ${displayName} has been added to your cart. ${nextNode.prompt_text || 'Press 1 for Another Product. Press 2 for Checkout. Press star for Main Menu.'}`,
        }),
      };
    }

    return {
      type: 'actions',
      response: buildGather({
        prompt: `${qty} of ${displayName} has been added to your cart. Press 1 for Another Product. Press 2 for Checkout. Press star for Main Menu.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 8,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'catalog_after_add',
        },
      }),
    };
  } catch (error) {
    console.error('Add to cart error:', error);
    return {
      type: 'actions',
      response: buildSay(
        'There was an error adding the product to your cart. Please try again.',
        '/api/ivr/voice/gather',
        { call_sid: ctx.callSid, user_id: userId, node_key: 'catalog_input' }
      ),
    };
  }
});
