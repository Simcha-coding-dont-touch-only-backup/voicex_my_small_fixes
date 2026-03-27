import type { Request, Response } from 'express';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildGather, buildSay, buildHangup, formatCurrency } from '../../twilio/twiml-builder.js';
import { normalizeInput } from '../../twilio/speech-normalizer.js';
import { getProductDisplayName, getProductPriceCents } from '@voicex/shared';
import { ryeClient } from '../../../lib/rye.js';
import { buildMainMenuTwiml } from './pin-flow.js';
import type { IvrIntent } from '@voicex/shared';

const CATALOG_ACTION_INTENTS: IvrIntent[] = [
  { name: 'add_to_cart', dtmf_key: '1', speech_phrases: ['add to cart', 'add', 'one', 'buy'], target_node_key: 'catalog_qty' },
  { name: 'more_details', dtmf_key: '2', speech_phrases: ['more details', 'details', 'two', 'description'], target_node_key: 'catalog_details' },
  { name: 'reviews', dtmf_key: '3', speech_phrases: ['reviews', 'three', 'get reviews'], target_node_key: 'catalog_reviews' },
  { name: 'another', dtmf_key: '4', speech_phrases: ['another product', 'four', 'another'], target_node_key: 'catalog_input' },
  { name: 'main_menu', dtmf_key: '*', speech_phrases: ['main menu', 'back', 'menu', 'star'], target_node_key: 'main_menu' },
];

const AFTER_ADD_INTENTS: IvrIntent[] = [
  { name: 'another', dtmf_key: '1', speech_phrases: ['another', 'one', 'add another', 'another product'], target_node_key: 'catalog_input' },
  { name: 'checkout', dtmf_key: '2', speech_phrases: ['checkout', 'two', 'cart'], target_node_key: 'cart_menu' },
  { name: 'main_menu', dtmf_key: '*', speech_phrases: ['main menu', 'star', 'back'], target_node_key: 'main_menu' },
];

export async function handleCatalogFlow(req: Request, res: Response) {
  const step = req.query.step as string;
  const userId = req.query.user_id as string;
  const callSid = req.query.call_sid as string;

  switch (step) {
    case 'catalog_input':
      return handleCatalogInput(req, res, userId, callSid);
    case 'catalog_action':
      return handleCatalogAction(req, res, userId, callSid);
    case 'catalog_qty':
      return handleCatalogQty(req, res, userId, callSid);
    case 'catalog_qty_confirm':
      return handleCatalogQtyConfirm(req, res, userId, callSid);
    case 'catalog_after_add':
      return handleAfterAdd(req, res, userId, callSid);
  }
}

async function handleCatalogInput(
  req: Request, res: Response, userId: string, callSid: string
) {
  const digits = req.body.Digits;

  if (!digits) {
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please enter the catalog number followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'catalog_input' },
      })
    );
    return;
  }

  const { data: product } = await supabaseAdmin
    .from('catalog_products')
    .select('*')
    .eq('voicex_id', digits)
    .eq('is_active', true)
    .single();

  if (!product) {
    res.type('text/xml').send(
      buildGather({
        prompt: `Product with catalog number ${digits.split('').join(' ')} was not found. Please enter a different catalog number.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, user_id: userId, step: 'catalog_input' },
      })
    );
    return;
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

  res.type('text/xml').send(
    buildGather({
      prompt: `${displayName}, priced at ${priceStr}. Press 1 or say Add to Cart. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product. Press star to go back to the Main Menu.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      timeout: 10,
      hints: ['add to cart', 'more details', 'reviews', 'another product', 'main menu'],
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'catalog_action',
        product_id: product.id,
        voicex_id: product.voicex_id,
      },
    })
  );
}

async function handleCatalogAction(
  req: Request, res: Response, userId: string, callSid: string
) {
  const productId = req.query.product_id as string;
  const voicexId = req.query.voicex_id as string;
  const digits = req.body.Digits;
  const speechResult = req.body.SpeechResult;
  const confidence = req.body.Confidence;

  const input = normalizeInput(digits, speechResult, confidence, CATALOG_ACTION_INTENTS);

  switch (input.matchedIntent) {
    case 'add_to_cart':
      res.type('text/xml').send(
        buildGather({
          prompt: 'How many would you like to add? Enter the quantity.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf',
          timeout: 10,
          finishOnKey: '#',
          sessionData: {
            call_sid: callSid,
            user_id: userId,
            step: 'catalog_qty',
            product_id: productId,
            voicex_id: voicexId,
          },
        })
      );
      break;

    case 'more_details': {
      const { data: product } = await supabaseAdmin
        .from('catalog_products')
        .select('*')
        .eq('id', productId)
        .single();

      const description = product?.voice_description || product?.amazon_description || 'No description available.';

      res.type('text/xml').send(
        buildGather({
          prompt: `${description}. Press 1 to Add to Cart. Press 4 for Another Product. Press star for Main Menu.`,
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf speech',
          timeout: 10,
          hints: ['add to cart', 'another product', 'main menu'],
          sessionData: {
            call_sid: callSid,
            user_id: userId,
            step: 'catalog_action',
            product_id: productId,
            voicex_id: voicexId,
          },
        })
      );
      break;
    }

    case 'reviews':
      res.type('text/xml').send(
        buildGather({
          prompt: 'Reviews are currently being loaded from Amazon. This feature will be available shortly. Press 1 to Add to Cart. Press 4 for Another Product. Press star for Main Menu.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf speech',
          timeout: 10,
          hints: ['add to cart', 'another product', 'main menu'],
          sessionData: {
            call_sid: callSid,
            user_id: userId,
            step: 'catalog_action',
            product_id: productId,
            voicex_id: voicexId,
          },
        })
      );
      break;

    case 'another':
      res.type('text/xml').send(
        buildGather({
          prompt: 'Enter the catalog number for the next product.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf',
          timeout: 10,
          finishOnKey: '#',
          sessionData: { call_sid: callSid, user_id: userId, step: 'catalog_input' },
        })
      );
      break;

    case 'main_menu':
      res.type('text/xml').send(buildMainMenuTwiml(callSid, userId));
      break;

    default:
      res.type('text/xml').send(
        buildGather({
          prompt: 'Press 1 to Add to Cart. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product. Press star for Main Menu.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf speech',
          timeout: 8,
          sessionData: {
            call_sid: callSid,
            user_id: userId,
            step: 'catalog_action',
            product_id: productId,
            voicex_id: voicexId,
          },
        })
      );
  }
}

async function handleCatalogQty(
  req: Request, res: Response, userId: string, callSid: string
) {
  const productId = req.query.product_id as string;
  const voicexId = req.query.voicex_id as string;
  const digits = req.body.Digits;

  const qty = parseInt(digits || '0', 10);
  if (!qty || qty <= 0) {
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please enter a valid quantity.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'catalog_qty',
          product_id: productId,
          voicex_id: voicexId,
        },
      })
    );
    return;
  }

  res.type('text/xml').send(
    buildGather({
      prompt: `You entered a quantity of ${qty}. Press 1 to confirm, or press 2 to re-enter.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
      numDigits: 1,
      timeout: 10,
      finishOnKey: '',
      sessionData: {
        call_sid: callSid,
        user_id: userId,
        step: 'catalog_qty_confirm',
        product_id: productId,
        voicex_id: voicexId,
        qty: qty.toString(),
      },
    })
  );
}

async function handleCatalogQtyConfirm(
  req: Request, res: Response, userId: string, callSid: string
) {
  const productId = req.query.product_id as string;
  const voicexId = req.query.voicex_id as string;
  const qty = parseInt(req.query.qty as string, 10);
  const digits = req.body.Digits;

  if (digits === '2') {
    res.type('text/xml').send(
      buildGather({
        prompt: 'Enter the quantity.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'catalog_qty',
          product_id: productId,
          voicex_id: voicexId,
        },
      })
    );
    return;
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

    res.type('text/xml').send(
      buildGather({
        prompt: `${qty} of ${displayName} has been added to your cart. Press 1 or say Another Product to add more. Press 2 or say Checkout to proceed to your cart. Press star for Main Menu.`,
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 8,
        hints: ['another product', 'checkout', 'main menu', 'another'],
        sessionData: {
          call_sid: callSid,
          user_id: userId,
          step: 'catalog_after_add',
        },
      })
    );
  } catch (error) {
    console.error('Add to cart error:', error);
    res.type('text/xml').send(
      buildSay(
        'There was an error adding the product to your cart. Please try again.',
        `/api/twilio/voice/gather?step=catalog_input&user_id=${userId}&call_sid=${callSid}`
      )
    );
  }
}

async function handleAfterAdd(
  req: Request, res: Response, userId: string, callSid: string
) {
  const digits = req.body.Digits;
  const speechResult = req.body.SpeechResult;
  const confidence = req.body.Confidence;

  const input = normalizeInput(digits, speechResult, confidence, AFTER_ADD_INTENTS);

  switch (input.matchedIntent) {
    case 'another':
      res.type('text/xml').send(
        buildGather({
          prompt: 'Enter the catalog number for the next product.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf',
          timeout: 10,
          finishOnKey: '#',
          sessionData: { call_sid: callSid, user_id: userId, step: 'catalog_input' },
        })
      );
      break;

    case 'checkout':
      res.type('text/xml').send(
        buildSay(
          'Loading your cart.',
          `/api/twilio/voice/gather?step=cart_menu&user_id=${userId}&call_sid=${callSid}`
        )
      );
      break;

    case 'main_menu':
      res.type('text/xml').send(buildMainMenuTwiml(callSid, userId));
      break;

    default:
      res.type('text/xml').send(
        buildGather({
          prompt: 'Press 1 for Another Product. Press 2 for Checkout. Press star for Main Menu.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf speech',
          timeout: 8,
          sessionData: { call_sid: callSid, user_id: userId, step: 'catalog_after_add' },
        })
      );
  }
}
