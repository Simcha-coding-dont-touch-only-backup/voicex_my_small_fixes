/**
 * Subscription IVR: main menu, explanation/terms gate, hear-package, and the
 * add-product flow. (Edit/transfer/remove live in subscriptions-handlers-edit;
 * pause/address/card in subscriptions-handlers-manage; the alerts inbox in
 * subscriptions-alerts-inbox.)
 */
import { registerHandler } from '../handler-registry.js';
import { supabaseAdmin } from '../../../lib/supabase.js';
import {
  base,
  gather,
  say,
  sayToMenu,
  resolveDelivery,
  getSubscriptionCtx,
  weekFromDigit,
  weekSelectPrompt,
  lookupActiveProduct,
  productPriceStr,
  speakPackageList,
  weekLabel,
  getDeliveries,
  getDeliveryItems,
  getProductDisplayName,
} from './subscriptions-shared.js';
import {
  recordTermsExplanationPlayed,
  setDeliveryItemQuantity,
  findDeliveryItem,
  logSubscriptionEvent,
} from '../../../lib/subscriptions.js';
import { TERMS_EXPLANATION_REQUIRED_PLAYS } from '@voicex/shared';

const EXPLANATION_TEXT =
  'Subscriptions allow you to automatically order products that you need on a constant basis. ' +
  'Once you set up your delivery packages, your orders will be shipped out to you consistently at your selected time slots, ' +
  'without you having to do anything on your end. We process up to four deliveries each month. ' +
  'The first delivery is processed on the 1st of each month. The second on the 8th. The third on the 15th. The fourth on the 22nd. ' +
  'If while processing a delivery there is less quantity available than what you selected, we will send whatever quantity is possible. ' +
  'If a product is out of stock, we will still process the remainder of the products from the package. ' +
  'Any change you make after midnight Eastern time going into a processing date applies to the next cycle, not the one processed that morning. ' +
  'By confirming a delivery, you authorize VoiceX to automatically place and charge subscription orders for the selected delivery packages according to its schedule. ' +
  'Prices and availability may change. Subscription orders use the current VoiceX selling price at processing time.';

function renderMainMenu(ctx: any, termsCount: number) {
  const explanationOption = termsCount >= TERMS_EXPLANATION_REQUIRED_PLAYS
    ? ' For an explanation of how subscriptions work, press 9.'
    : '';
  const prompt =
    'Subscriptions. To add products, press 1. To hear the products in your packages, press 2. ' +
    'To edit product quantity, press 3. To transfer products, press 4. To remove products, press 5. ' +
    'To pause or reactivate a delivery, press 6. To set your subscription address, press 7. ' +
    'To set your subscription card, press 8.' + explanationOption;
  return gather(prompt, { ...base(ctx), node_key: 'subscriptions_menu_select' }, { numDigits: 1, timeout: 12 });
}

// Entry from the main menu (option 5). Auto-plays the explanation until the
// caller has heard it twice, then shows the menu.
registerHandler('subscriptions_entry', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  if ((subscription.terms_explanation_count ?? 0) < TERMS_EXPLANATION_REQUIRED_PLAYS) {
    await recordTermsExplanationPlayed(subscription.id);
    return gather(
      `Here is how subscriptions work. To skip and confirm you agree to the terms, press 1. ${EXPLANATION_TEXT}`,
      { ...base(ctx), node_key: 'subscriptions_menu' },
      { numDigits: 1, timeout: 8 },
    );
  }
  return renderMainMenu(ctx, subscription.terms_explanation_count ?? 0);
});

// Render-only main menu (also the post-gate landing). Ignores any pressed digit.
registerHandler('subscriptions_menu', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  return renderMainMenu(ctx, subscription.terms_explanation_count ?? 0);
});

// Explicit explanation (menu option 9). Plays, counts, returns to the menu.
registerHandler('subscriptions_explanation', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  await recordTermsExplanationPlayed(subscription.id);
  return say(ctx, EXPLANATION_TEXT, 'subscriptions_menu');
});

// Process a main-menu selection (1-9).
registerHandler('subscriptions_menu_select', async (ctx) => {
  const digits = ctx.req.body.digits;
  switch (digits) {
    case '1':
      return gather(weekSelectPrompt('To add products to your'), { ...base(ctx), node_key: 'subscriptions_add_select_week' }, { numDigits: 1 });
    case '2':
      return gather(weekSelectPrompt('To hear the products in your'), { ...base(ctx), node_key: 'subscriptions_hear_select_week' }, { numDigits: 1 });
    case '3':
      return gather(weekSelectPrompt('To edit products in your'), { ...base(ctx), node_key: 'subscriptions_edit_select_week' }, { numDigits: 1 });
    case '4':
      return gather(weekSelectPrompt('To transfer products from your'), { ...base(ctx), node_key: 'subscriptions_transfer_select_week' }, { numDigits: 1 });
    case '5':
      return gather(weekSelectPrompt('To remove products from your'), { ...base(ctx), node_key: 'subscriptions_remove_select_week' }, { numDigits: 1 });
    case '6':
      return say(ctx, 'Pause or reactivate.', 'subscriptions_pause_select');
    case '7':
      return say(ctx, 'Subscription address.', 'subscriptions_address_menu');
    case '8':
      return say(ctx, 'Subscription card.', 'subscriptions_card_menu');
    case '9': {
      const subscription = await getSubscriptionCtx(ctx);
      if ((subscription.terms_explanation_count ?? 0) >= TERMS_EXPLANATION_REQUIRED_PLAYS) {
        return say(ctx, 'Here is how subscriptions work.', 'subscriptions_explanation');
      }
      return renderMainMenu(ctx, subscription.terms_explanation_count ?? 0);
    }
    default: {
      const subscription = await getSubscriptionCtx(ctx);
      return renderMainMenu(ctx, subscription.terms_explanation_count ?? 0);
    }
  }
});

// ============================================================
// Hear products
// ============================================================

registerHandler('subscriptions_hear_select_week', async (ctx) => {
  const week = weekFromDigit(ctx.req.body.digits);
  if (!week) return gather(weekSelectPrompt('To hear the products in your'), { ...base(ctx), node_key: 'subscriptions_hear_select_week' }, { numDigits: 1 });
  return say(ctx, `Your ${weekLabel(week)} Delivery.`, 'subscriptions_hear_package', { week: String(week) });
});

registerHandler('subscriptions_hear_package', async (ctx) => {
  const week = parseInt(ctx.sessionData.week || '0', 10);
  if (!week) return sayToMenu(ctx, 'Returning to the main subscription menu.');
  const { delivery } = await resolveDelivery(ctx, week);
  const items = await getDeliveryItems(delivery.id);
  const paused = delivery.status !== 'active';

  if (items.length === 0) {
    return gather(
      `Your ${weekLabel(week)} Delivery package currently contains no products. To add a product, press 1. To hear your other delivery packages, press 2. To return to the main subscription menu, press 3.`,
      { ...base(ctx), node_key: 'subscriptions_hear_empty_action', week: String(week) },
      { numDigits: 1 },
    );
  }

  const list = speakPackageList(items);
  const pauseOpt = paused ? 'To reactivate this delivery, press 6.' : 'To pause this delivery, press 6.';
  return gather(
    `Your ${weekLabel(week)} Delivery contains the following products. ${list}. To hear your other delivery packages, press 1. To add products, press 2. To edit product quantity, press 3. To transfer products, press 4. To remove products, press 5. ${pauseOpt}`,
    { ...base(ctx), node_key: 'subscriptions_hear_full_action', week: String(week) },
    { numDigits: 1, timeout: 12 },
  );
});

registerHandler('subscriptions_hear_empty_action', async (ctx) => {
  const week = parseInt(ctx.sessionData.week || '0', 10);
  switch (ctx.req.body.digits) {
    case '1':
      return say(ctx, 'Add a product.', 'subscriptions_add_product_entry', { week: String(week) });
    case '2':
      return gather(weekSelectPrompt('To hear the products in your'), { ...base(ctx), node_key: 'subscriptions_hear_select_week' }, { numDigits: 1 });
    case '3':
      return sayToMenu(ctx, 'Returning to the main subscription menu.');
    default:
      return say(ctx, '', 'subscriptions_hear_package', { week: String(week) });
  }
});

registerHandler('subscriptions_hear_full_action', async (ctx) => {
  const week = parseInt(ctx.sessionData.week || '0', 10);
  switch (ctx.req.body.digits) {
    case '1':
      return gather(weekSelectPrompt('To hear the products in your'), { ...base(ctx), node_key: 'subscriptions_hear_select_week' }, { numDigits: 1 });
    case '2':
      return say(ctx, 'Add a product.', 'subscriptions_add_product_entry', { week: String(week) });
    case '3':
      return say(ctx, 'Edit product quantity.', 'subscriptions_edit_method', { week: String(week) });
    case '4':
      return say(ctx, 'Transfer products.', 'subscriptions_transfer_method', { week: String(week) });
    case '5':
      return say(ctx, 'Remove products.', 'subscriptions_remove_choice', { week: String(week) });
    case '6':
      return say(ctx, 'Pause or reactivate.', 'subscriptions_pause_options', { week: String(week) });
    default:
      return say(ctx, '', 'subscriptions_hear_package', { week: String(week) });
  }
});

// ============================================================
// Add products
// ============================================================

registerHandler('subscriptions_add_select_week', async (ctx) => {
  const week = weekFromDigit(ctx.req.body.digits);
  if (!week) return gather(weekSelectPrompt('To add products to your'), { ...base(ctx), node_key: 'subscriptions_add_select_week' }, { numDigits: 1 });
  return say(ctx, `Adding to your ${weekLabel(week)} Delivery.`, 'subscriptions_add_product_entry', { week: String(week) });
});

registerHandler('subscriptions_add_product_entry', async (ctx) => {
  const week = parseInt(ctx.sessionData.week || '0', 10);
  const digits = ctx.req.body.digits;
  if (!digits) {
    return gather(
      'Please enter the catalog number for the product you would like to look up, followed by pound.',
      { ...base(ctx), node_key: 'subscriptions_add_product_entry', week: String(week) },
      { finishOnKey: '#' },
    );
  }
  const product = await lookupActiveProduct(digits);
  if (!product) {
    return gather(
      `Product with catalog number ${digits.split('').join(' ')} was not found. Please enter a different catalog number, followed by pound.`,
      { ...base(ctx), node_key: 'subscriptions_add_product_entry', week: String(week) },
      { finishOnKey: '#' },
    );
  }
  const priceStr = await productPriceStr(product, ctx.sessionData.user_id);
  return gather(
    `You have selected ${getProductDisplayName(product)}, priced at ${priceStr}. Press 1 to add it to this package. Press 2 for more details. Press 3 for reviews. Press 4 for another product.`,
    { ...base(ctx), node_key: 'subscriptions_add_selected', week: String(week), product_id: product.id, voicex_id: product.voicex_id },
    { numDigits: 1 },
  );
});

registerHandler('subscriptions_add_selected', async (ctx) => {
  const { week, product_id, voicex_id } = ctx.sessionData;
  const digits = ctx.req.body.digits;
  const carry = { week, product_id, voicex_id };

  if (digits === '1') {
    return gather(
      'How many would you like to add? Enter the quantity and then press pound.',
      { ...base(ctx), node_key: 'subscriptions_add_qty', ...carry },
      { finishOnKey: '#' },
    );
  }
  if (digits === '2') {
    const { data } = await supabaseAdmin
      .from('catalog_products')
      .select('*')
      .eq('id', product_id)
      .maybeSingle();
    const desc = data?.voice_description || data?.amazon_description || 'No additional details are available for this product.';
    return gather(
      `${desc}. Press 1 to add it to this package. Press 4 for another product.`,
      { ...base(ctx), node_key: 'subscriptions_add_selected', ...carry },
      { numDigits: 1 },
    );
  }
  if (digits === '3') {
    const { data } = await supabaseAdmin
      .from('catalog_products')
      .select('amazon_star_rating, amazon_ratings_total')
      .eq('id', product_id)
      .maybeSingle();
    let review = 'Review information is not available for this product.';
    if (data?.amazon_ratings_total) {
      review = data.amazon_star_rating
        ? `This product has a rating of ${data.amazon_star_rating} based on ${data.amazon_ratings_total.toLocaleString()} reviews.`
        : `This product has ${data.amazon_ratings_total.toLocaleString()} reviews.`;
    }
    return gather(
      `${review} Press 1 to add it to this package. Press 4 for another product.`,
      { ...base(ctx), node_key: 'subscriptions_add_selected', ...carry },
      { numDigits: 1 },
    );
  }
  if (digits === '4') {
    return say(ctx, 'Enter another product.', 'subscriptions_add_product_entry', { week });
  }
  return gather(
    'Press 1 to add it to this package. Press 2 for more details. Press 3 for reviews. Press 4 for another product.',
    { ...base(ctx), node_key: 'subscriptions_add_selected', ...carry },
    { numDigits: 1 },
  );
});

registerHandler('subscriptions_add_qty', async (ctx) => {
  const { week, product_id, voicex_id } = ctx.sessionData;
  const digits = ctx.req.body.digits;
  const qty = parseInt(digits || '0', 10);
  if (!qty || qty <= 0) {
    return gather(
      'Please enter a valid quantity, then press pound.',
      { ...base(ctx), node_key: 'subscriptions_add_qty', week, product_id, voicex_id },
      { finishOnKey: '#' },
    );
  }
  return gather(
    `You entered a quantity of ${qty}. Press 1 to confirm, or press 2 to re-enter.`,
    { ...base(ctx), node_key: 'subscriptions_add_qty_confirm', week, product_id, voicex_id, qty: String(qty) },
    { numDigits: 1 },
  );
});

registerHandler('subscriptions_add_qty_confirm', async (ctx) => {
  const { week, product_id, voicex_id, qty } = ctx.sessionData;
  const digits = ctx.req.body.digits;
  if (digits === '2') {
    return gather(
      'How many would you like to add? Enter the quantity and then press pound.',
      { ...base(ctx), node_key: 'subscriptions_add_qty', week, product_id, voicex_id },
      { finishOnKey: '#' },
    );
  }
  if (digits !== '1') {
    return gather(
      `You entered a quantity of ${qty}. Press 1 to confirm, or press 2 to re-enter.`,
      { ...base(ctx), node_key: 'subscriptions_add_qty_confirm', week, product_id, voicex_id, qty },
      { numDigits: 1 },
    );
  }

  const weekNum = parseInt(week, 10);
  const quantity = parseInt(qty, 10);
  const { subscription, delivery } = await resolveDelivery(ctx, weekNum);
  await setDeliveryItemQuantity(delivery.id, product_id, quantity);
  await logSubscriptionEvent({
    subscriptionId: subscription.id,
    deliveryId: delivery.id,
    eventType: 'item_added',
    actorType: 'hotline',
    details: { product_id, voicex_id, quantity, week: weekNum },
  });

  // Determine if this product can be added to another week's package.
  const deliveries = await getDeliveries(subscription.id);
  const otherWeeks: number[] = [];
  for (const w of [1, 2, 3, 4]) {
    if (w === weekNum) continue;
    const d = deliveries.find((x) => x.week_number === w);
    if (!d) {
      otherWeeks.push(w);
      continue;
    }
    const existing = await findDeliveryItem(d.id, product_id);
    if (!existing) otherWeeks.push(w);
  }

  const product = await lookupActiveProduct(voicex_id);
  const name = product ? getProductDisplayName(product) : 'The product';
  const otherOpt = otherWeeks.length > 0 ? ' Press 3 to add this same product to another delivery package.' : '';
  return gather(
    `${name} has been added to your ${weekLabel(weekNum)} Delivery package. Press 1 to add another product. Press 2 to go back to the main subscription menu.${otherOpt}`,
    { ...base(ctx), node_key: 'subscriptions_add_done', week, product_id, voicex_id, other_weeks: otherWeeks.join(',') },
    { numDigits: 1 },
  );
});

registerHandler('subscriptions_add_done', async (ctx) => {
  const { week, product_id, voicex_id, other_weeks } = ctx.sessionData;
  const digits = ctx.req.body.digits;
  if (digits === '1') {
    return say(ctx, 'Add another product.', 'subscriptions_add_product_entry', { week });
  }
  if (digits === '2') {
    return sayToMenu(ctx, 'Returning to the main subscription menu.');
  }
  if (digits === '3' && other_weeks) {
    const weeks = other_weeks.split(',').filter(Boolean).map((w: string) => parseInt(w, 10));
    if (weeks.length > 0) {
      const opts = weeks.map((w: number, i: number) => `Press ${i + 1} to add it to your ${weekLabel(w)} Delivery package`);
      return gather(
        `${opts.join('. ')}.`,
        { ...base(ctx), node_key: 'subscriptions_add_to_other', product_id, voicex_id, other_weeks },
        { numDigits: 1 },
      );
    }
  }
  return gather(
    'Press 1 to add another product. Press 2 to go back to the main subscription menu.',
    { ...base(ctx), node_key: 'subscriptions_add_done', week, product_id, voicex_id, other_weeks: other_weeks || '' },
    { numDigits: 1 },
  );
});

registerHandler('subscriptions_add_to_other', async (ctx) => {
  const { product_id, voicex_id, other_weeks } = ctx.sessionData;
  const weeks = (other_weeks || '').split(',').filter(Boolean).map((w: string) => parseInt(w, 10));
  const idx = parseInt(ctx.req.body.digits || '', 10) - 1;
  const targetWeek = weeks[idx];
  if (!targetWeek) {
    const opts = weeks.map((w: number, i: number) => `Press ${i + 1} to add it to your ${weekLabel(w)} Delivery package`);
    return gather(`${opts.join('. ')}.`, { ...base(ctx), node_key: 'subscriptions_add_to_other', product_id, voicex_id, other_weeks }, { numDigits: 1 });
  }
  // Reuse the qty flow targeting the chosen week.
  return gather(
    'How many would you like to add? Enter the quantity and then press pound.',
    { ...base(ctx), node_key: 'subscriptions_add_qty', week: String(targetWeek), product_id, voicex_id },
    { finishOnKey: '#' },
  );
});
