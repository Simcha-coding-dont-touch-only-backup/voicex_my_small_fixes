/**
 * Subscription IVR: edit quantity, transfer, and remove (incl. clear package).
 */
import { registerHandler } from '../handler-registry.js';
import {
  base,
  gather,
  say,
  sayToMenu,
  resolveDelivery,
  weekFromDigit,
  weekSelectPrompt,
  weekLabel,
  getDeliveries,
  getDeliveryItems,
  getProductDisplayName,
  findPackageItemByDialedId,
  indexedItemListPrompt,
} from './subscriptions-shared.js';
import {
  setDeliveryItemQuantity,
  removeDeliveryItem,
  clearDeliveryPackage,
  transferDeliveryItem,
  findDeliveryItem,
  getOrCreateDelivery,
  logSubscriptionEvent,
} from '../../../lib/subscriptions.js';

const NOT_FOUND_PROMPT = (digits: string) =>
  `Product with catalog number ${digits.split('').join(' ')} was not found in this package. Please enter a different catalog number, followed by pound.`;

// ============================================================
// Edit quantity
// ============================================================

registerHandler('subscriptions_edit_select_week', async (ctx) => {
  const week = weekFromDigit(ctx.req.body.digits);
  if (!week) return gather(weekSelectPrompt('To edit products in your'), { ...base(ctx), node_key: 'subscriptions_edit_select_week' }, { numDigits: 1 });
  return say(ctx, `Editing your ${weekLabel(week)} Delivery.`, 'subscriptions_edit_method', { week: String(week) });
});

registerHandler('subscriptions_edit_method', async (ctx) => {
  const week = ctx.sessionData.week;
  const digits = ctx.req.body.digits;
  if (digits === '1') {
    return gather('Please enter the catalog number for the product you would like to change, followed by pound.', { ...base(ctx), node_key: 'subscriptions_edit_id_entry', week }, { finishOnKey: '#' });
  }
  if (digits === '2') {
    const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
    const items = await getDeliveryItems(delivery.id);
    if (items.length === 0) return sayToMenu(ctx, 'That package is empty. Returning to the main subscription menu.');
    const { prompt, ids } = indexedItemListPrompt(items, 'edit');
    return gather(prompt, { ...base(ctx), node_key: 'subscriptions_edit_list', week, product_ids: ids }, { finishOnKey: '#', timeout: 4, tries: 3 });
  }
  return gather("If you know your product's VoiceX ID, press 1. To hear a list of all products in this package, press 2.", { ...base(ctx), node_key: 'subscriptions_edit_method', week }, { numDigits: 1 });
});

registerHandler('subscriptions_edit_id_entry', async (ctx) => {
  const week = ctx.sessionData.week;
  const digits = ctx.req.body.digits;
  if (!digits) return gather('Please enter the catalog number for the product you would like to change, followed by pound.', { ...base(ctx), node_key: 'subscriptions_edit_id_entry', week }, { finishOnKey: '#' });
  const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
  const item = await findPackageItemByDialedId(delivery.id, digits);
  if (!item) return gather(NOT_FOUND_PROMPT(digits), { ...base(ctx), node_key: 'subscriptions_edit_id_entry', week }, { finishOnKey: '#' });
  return editQtyEntryPrompt(ctx, week, item.product_id);
});

registerHandler('subscriptions_edit_list', async (ctx) => {
  const week = ctx.sessionData.week;
  const ids = (ctx.sessionData.product_ids || '').split(',').filter(Boolean);
  const idx = parseInt(ctx.req.body.digits || '', 10) - 1;
  const productId = ids[idx];
  if (!productId) {
    const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
    const items = await getDeliveryItems(delivery.id);
    const { prompt, ids: csv } = indexedItemListPrompt(items, 'edit');
    return gather(prompt, { ...base(ctx), node_key: 'subscriptions_edit_list', week, product_ids: csv }, { finishOnKey: '#', timeout: 4, tries: 3 });
  }
  return editQtyEntryPrompt(ctx, week, productId);
});

async function editQtyEntryPrompt(ctx: any, week: string, productId: string) {
  const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
  const item = await findDeliveryItem(delivery.id, productId);
  if (!item) return sayToMenu(ctx, 'That product is no longer in the package. Returning to the main subscription menu.');
  const name = item.catalog_products ? getProductDisplayName(item.catalog_products) : 'the product';
  return gather(
    `You have selected ${name} with quantity ${item.quantity}. Enter your new quantity, and then press pound.`,
    { ...base(ctx), node_key: 'subscriptions_edit_qty_confirm', week, product_id: productId },
    { finishOnKey: '#' },
  );
}

registerHandler('subscriptions_edit_qty_confirm', async (ctx) => {
  const { week, product_id } = ctx.sessionData;
  const qtyDigits = ctx.sessionData.qty;
  const digits = ctx.req.body.digits;

  // First pass: caller just entered the new quantity (no qty in session yet).
  if (!qtyDigits) {
    const qty = parseInt(digits || '0', 10);
    if (!qty || qty <= 0) {
      return gather('Please enter a valid quantity, then press pound.', { ...base(ctx), node_key: 'subscriptions_edit_qty_confirm', week, product_id }, { finishOnKey: '#' });
    }
    return gather(`Press 1 to confirm the new quantity of ${qty}, or press 2 to re-enter.`, { ...base(ctx), node_key: 'subscriptions_edit_qty_confirm', week, product_id, qty: String(qty) }, { numDigits: 1 });
  }

  // Second pass: confirm / re-enter.
  if (digits === '2') {
    return gather('Enter your new quantity, and then press pound.', { ...base(ctx), node_key: 'subscriptions_edit_qty_confirm', week, product_id }, { finishOnKey: '#' });
  }
  if (digits !== '1') {
    return gather(`Press 1 to confirm the new quantity of ${qtyDigits}, or press 2 to re-enter.`, { ...base(ctx), node_key: 'subscriptions_edit_qty_confirm', week, product_id, qty: qtyDigits }, { numDigits: 1 });
  }

  const quantity = parseInt(qtyDigits, 10);
  const { subscription, delivery } = await resolveDelivery(ctx, parseInt(week, 10));
  await setDeliveryItemQuantity(delivery.id, product_id, quantity);
  const item = await findDeliveryItem(delivery.id, product_id);
  const name = item?.catalog_products ? getProductDisplayName(item.catalog_products) : 'the product';
  await logSubscriptionEvent({ subscriptionId: subscription.id, deliveryId: delivery.id, eventType: 'item_qty_updated', actorType: 'hotline', details: { product_id, quantity, week: parseInt(week, 10) } });
  return gather(
    `The quantity for ${name} has been updated to ${quantity}. Press 1 to change the quantity of another product. Press 2 to go back to the main subscription menu.`,
    { ...base(ctx), node_key: 'subscriptions_edit_done', week },
    { numDigits: 1 },
  );
});

registerHandler('subscriptions_edit_done', async (ctx) => {
  const week = ctx.sessionData.week;
  if (ctx.req.body.digits === '1') return say(ctx, 'Edit another product.', 'subscriptions_edit_method', { week });
  if (ctx.req.body.digits === '2') return sayToMenu(ctx, 'Returning to the main subscription menu.');
  return gather('Press 1 to change the quantity of another product. Press 2 to go back to the main subscription menu.', { ...base(ctx), node_key: 'subscriptions_edit_done', week }, { numDigits: 1 });
});

// ============================================================
// Transfer
// ============================================================

registerHandler('subscriptions_transfer_select_week', async (ctx) => {
  const week = weekFromDigit(ctx.req.body.digits);
  if (!week) return gather(weekSelectPrompt('To transfer products from your'), { ...base(ctx), node_key: 'subscriptions_transfer_select_week' }, { numDigits: 1 });
  return say(ctx, `Transferring from your ${weekLabel(week)} Delivery.`, 'subscriptions_transfer_method', { week: String(week) });
});

registerHandler('subscriptions_transfer_method', async (ctx) => {
  const week = ctx.sessionData.week;
  const digits = ctx.req.body.digits;
  if (digits === '1') {
    return gather('Please enter the catalog number for the product you would like to transfer, followed by pound.', { ...base(ctx), node_key: 'subscriptions_transfer_id_entry', week }, { finishOnKey: '#' });
  }
  if (digits === '2') {
    const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
    const items = await getDeliveryItems(delivery.id);
    if (items.length === 0) return sayToMenu(ctx, 'That package is empty. Returning to the main subscription menu.');
    const { prompt, ids } = indexedItemListPrompt(items, 'transfer');
    return gather(prompt, { ...base(ctx), node_key: 'subscriptions_transfer_list', week, product_ids: ids }, { finishOnKey: '#', timeout: 4, tries: 3 });
  }
  return gather("If you know your product's VoiceX ID, press 1. To hear a list of all products in this package, press 2.", { ...base(ctx), node_key: 'subscriptions_transfer_method', week }, { numDigits: 1 });
});

registerHandler('subscriptions_transfer_id_entry', async (ctx) => {
  const week = ctx.sessionData.week;
  const digits = ctx.req.body.digits;
  if (!digits) return gather('Please enter the catalog number for the product you would like to transfer, followed by pound.', { ...base(ctx), node_key: 'subscriptions_transfer_id_entry', week }, { finishOnKey: '#' });
  const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
  const item = await findPackageItemByDialedId(delivery.id, digits);
  if (!item) return gather(NOT_FOUND_PROMPT(digits), { ...base(ctx), node_key: 'subscriptions_transfer_id_entry', week }, { finishOnKey: '#' });
  return transferPickDest(ctx, week, item.product_id);
});

registerHandler('subscriptions_transfer_list', async (ctx) => {
  const week = ctx.sessionData.week;
  const ids = (ctx.sessionData.product_ids || '').split(',').filter(Boolean);
  const idx = parseInt(ctx.req.body.digits || '', 10) - 1;
  const productId = ids[idx];
  if (!productId) {
    const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
    const items = await getDeliveryItems(delivery.id);
    const { prompt, ids: csv } = indexedItemListPrompt(items, 'transfer');
    return gather(prompt, { ...base(ctx), node_key: 'subscriptions_transfer_list', week, product_ids: csv }, { finishOnKey: '#', timeout: 4, tries: 3 });
  }
  return transferPickDest(ctx, week, productId);
});

async function transferPickDest(ctx: any, week: string, productId: string) {
  const weekNum = parseInt(week, 10);
  const { subscription, delivery } = await resolveDelivery(ctx, weekNum);
  const item = await findDeliveryItem(delivery.id, productId);
  if (!item) return sayToMenu(ctx, 'That product is no longer in the package. Returning to the main subscription menu.');
  const name = item.catalog_products ? getProductDisplayName(item.catalog_products) : 'the product';

  // Eligible destinations: weeks that do not already contain the product.
  const deliveries = await getDeliveries(subscription.id);
  const dests: number[] = [];
  for (const w of [1, 2, 3, 4]) {
    if (w === weekNum) continue;
    const d = deliveries.find((x) => x.week_number === w);
    if (!d) { dests.push(w); continue; }
    const existing = await findDeliveryItem(d.id, productId);
    if (!existing) dests.push(w);
  }
  if (dests.length === 0) {
    return sayToMenu(ctx, `${name} is already in all of your other delivery packages. Returning to the main subscription menu.`);
  }
  const opts = dests.map((w, i) => `Press ${i + 1} to transfer it to your ${weekLabel(w)} Delivery package`);
  return gather(
    `You have selected ${name} with quantity ${item.quantity}. ${opts.join('. ')}.`,
    { ...base(ctx), node_key: 'subscriptions_transfer_done', week, product_id: productId, dest_weeks: dests.join(',') },
    { numDigits: 1 },
  );
}

registerHandler('subscriptions_transfer_done', async (ctx) => {
  const { week, product_id, dest_weeks } = ctx.sessionData;
  const digits = ctx.req.body.digits;
  const dests = (dest_weeks || '').split(',').filter(Boolean).map((w: string) => parseInt(w, 10));
  const idx = parseInt(digits || '', 10) - 1;
  const targetWeek = dests[idx];

  if (targetWeek) {
    const weekNum = parseInt(week, 10);
    const { subscription, delivery } = await resolveDelivery(ctx, weekNum);
    const destDelivery = await getOrCreateDelivery(subscription.id, targetWeek);
    const result = await transferDeliveryItem(delivery.id, destDelivery.id, product_id);
    if (result) {
      await logSubscriptionEvent({ subscriptionId: subscription.id, deliveryId: delivery.id, eventType: 'item_transferred', actorType: 'hotline', details: { product_id, from_week: weekNum, to_week: targetWeek, quantity: result.quantity } });
      const item = await findDeliveryItem(destDelivery.id, product_id);
      const name = item?.catalog_products ? getProductDisplayName(item.catalog_products) : 'The product';
      return gather(
        `${name} with a quantity of ${result.quantity} has been transferred to your ${weekLabel(targetWeek)} Delivery package. Press 1 to transfer another product. Press 2 to return to the main subscription menu.`,
        { ...base(ctx), node_key: 'subscriptions_transfer_after', week },
        { numDigits: 1 },
      );
    }
    return sayToMenu(ctx, 'We were unable to transfer that product. Returning to the main subscription menu.');
  }
  return sayToMenu(ctx, 'Returning to the main subscription menu.');
});

registerHandler('subscriptions_transfer_after', async (ctx) => {
  const week = ctx.sessionData.week;
  if (ctx.req.body.digits === '1') return say(ctx, 'Transfer another product.', 'subscriptions_transfer_method', { week });
  if (ctx.req.body.digits === '2') return sayToMenu(ctx, 'Returning to the main subscription menu.');
  return gather('Press 1 to transfer another product. Press 2 to return to the main subscription menu.', { ...base(ctx), node_key: 'subscriptions_transfer_after', week }, { numDigits: 1 });
});

// ============================================================
// Remove
// ============================================================

registerHandler('subscriptions_remove_select_week', async (ctx) => {
  const week = weekFromDigit(ctx.req.body.digits);
  if (!week) return gather(weekSelectPrompt('To remove products from your'), { ...base(ctx), node_key: 'subscriptions_remove_select_week' }, { numDigits: 1 });
  return say(ctx, `Removing from your ${weekLabel(week)} Delivery.`, 'subscriptions_remove_choice', { week: String(week) });
});

registerHandler('subscriptions_remove_choice', async (ctx) => {
  const week = ctx.sessionData.week;
  const digits = ctx.req.body.digits;
  if (digits === '1') {
    return gather(`Press 1 to confirm that you would like to remove all products from this delivery package and completely empty it. This action cannot be undone. Press 2 to cancel and go back.`, { ...base(ctx), node_key: 'subscriptions_remove_all_confirm', week }, { numDigits: 1 });
  }
  if (digits === '2') {
    return say(ctx, 'Remove a specific product.', 'subscriptions_remove_method', { week });
  }
  return gather('To remove all products in the package, press 1. To remove only a specific product, press 2.', { ...base(ctx), node_key: 'subscriptions_remove_choice', week }, { numDigits: 1 });
});

registerHandler('subscriptions_remove_all_confirm', async (ctx) => {
  const week = ctx.sessionData.week;
  const digits = ctx.req.body.digits;
  if (digits === '1') {
    const { subscription, delivery } = await resolveDelivery(ctx, parseInt(week, 10));
    await clearDeliveryPackage(delivery.id);
    await logSubscriptionEvent({ subscriptionId: subscription.id, deliveryId: delivery.id, eventType: 'package_cleared', actorType: 'hotline', details: { week: parseInt(week, 10) } });
    return gather(
      `All the products from the ${weekLabel(parseInt(week, 10))} Delivery package have been removed and your package is currently empty. To add a new product, press 1. To go back to the main subscription menu, press 2.`,
      { ...base(ctx), node_key: 'subscriptions_remove_all_done', week },
      { numDigits: 1 },
    );
  }
  if (digits === '2') {
    return gather('To remove all products in the package, press 1. To remove only a specific product, press 2.', { ...base(ctx), node_key: 'subscriptions_remove_choice', week }, { numDigits: 1 });
  }
  return gather('Press 1 to confirm that you would like to remove all products and empty this package. Press 2 to cancel and go back.', { ...base(ctx), node_key: 'subscriptions_remove_all_confirm', week }, { numDigits: 1 });
});

registerHandler('subscriptions_remove_all_done', async (ctx) => {
  const week = ctx.sessionData.week;
  if (ctx.req.body.digits === '1') return say(ctx, 'Add a product.', 'subscriptions_add_product_entry', { week });
  return sayToMenu(ctx, 'Returning to the main subscription menu.');
});

registerHandler('subscriptions_remove_method', async (ctx) => {
  const week = ctx.sessionData.week;
  const digits = ctx.req.body.digits;
  if (digits === '1') {
    return gather('Please enter the catalog number for the product you would like to remove, followed by pound.', { ...base(ctx), node_key: 'subscriptions_remove_id_entry', week }, { finishOnKey: '#' });
  }
  if (digits === '2') {
    const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
    const items = await getDeliveryItems(delivery.id);
    if (items.length === 0) return sayToMenu(ctx, 'That package is empty. Returning to the main subscription menu.');
    const { prompt, ids } = indexedItemListPrompt(items, 'remove');
    return gather(prompt, { ...base(ctx), node_key: 'subscriptions_remove_list', week, product_ids: ids }, { finishOnKey: '#', timeout: 4, tries: 3 });
  }
  return gather("If you know your product's VoiceX ID, press 1. To hear a list of all products in this package, press 2.", { ...base(ctx), node_key: 'subscriptions_remove_method', week }, { numDigits: 1 });
});

registerHandler('subscriptions_remove_id_entry', async (ctx) => {
  const week = ctx.sessionData.week;
  const digits = ctx.req.body.digits;
  if (!digits) return gather('Please enter the catalog number for the product you would like to remove, followed by pound.', { ...base(ctx), node_key: 'subscriptions_remove_id_entry', week }, { finishOnKey: '#' });
  const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
  const item = await findPackageItemByDialedId(delivery.id, digits);
  if (!item) return gather(NOT_FOUND_PROMPT(digits), { ...base(ctx), node_key: 'subscriptions_remove_id_entry', week }, { finishOnKey: '#' });
  return removeConfirmPrompt(ctx, week, item.product_id);
});

registerHandler('subscriptions_remove_list', async (ctx) => {
  const week = ctx.sessionData.week;
  const ids = (ctx.sessionData.product_ids || '').split(',').filter(Boolean);
  const idx = parseInt(ctx.req.body.digits || '', 10) - 1;
  const productId = ids[idx];
  if (!productId) {
    const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
    const items = await getDeliveryItems(delivery.id);
    const { prompt, ids: csv } = indexedItemListPrompt(items, 'remove');
    return gather(prompt, { ...base(ctx), node_key: 'subscriptions_remove_list', week, product_ids: csv }, { finishOnKey: '#', timeout: 4, tries: 3 });
  }
  return removeConfirmPrompt(ctx, week, productId);
});

async function removeConfirmPrompt(ctx: any, week: string, productId: string) {
  const { delivery } = await resolveDelivery(ctx, parseInt(week, 10));
  const item = await findDeliveryItem(delivery.id, productId);
  if (!item) return sayToMenu(ctx, 'That product is no longer in the package. Returning to the main subscription menu.');
  const name = item.catalog_products ? getProductDisplayName(item.catalog_products) : 'the product';
  return gather(
    `You have selected ${name} with quantity ${item.quantity}. Press 1 to confirm removal, or press 2 to re-enter.`,
    { ...base(ctx), node_key: 'subscriptions_remove_confirm', week, product_id: productId },
    { numDigits: 1 },
  );
}

registerHandler('subscriptions_remove_confirm', async (ctx) => {
  const { week, product_id } = ctx.sessionData;
  const digits = ctx.req.body.digits;
  if (digits === '2') {
    return say(ctx, 'Re-enter.', 'subscriptions_remove_method', { week });
  }
  if (digits !== '1') {
    return gather('Press 1 to confirm removal, or press 2 to re-enter.', { ...base(ctx), node_key: 'subscriptions_remove_confirm', week, product_id }, { numDigits: 1 });
  }
  const { subscription, delivery } = await resolveDelivery(ctx, parseInt(week, 10));
  const item = await findDeliveryItem(delivery.id, product_id);
  const name = item?.catalog_products ? getProductDisplayName(item.catalog_products) : 'The product';
  await removeDeliveryItem(delivery.id, product_id);
  await logSubscriptionEvent({ subscriptionId: subscription.id, deliveryId: delivery.id, eventType: 'item_removed', actorType: 'hotline', details: { product_id, week: parseInt(week, 10) } });
  return gather(
    `${name} was removed. Press 1 to remove another product. Press 2 to go back to the main subscription menu.`,
    { ...base(ctx), node_key: 'subscriptions_remove_done', week },
    { numDigits: 1 },
  );
});

registerHandler('subscriptions_remove_done', async (ctx) => {
  const week = ctx.sessionData.week;
  if (ctx.req.body.digits === '1') return say(ctx, 'Remove another product.', 'subscriptions_remove_method', { week });
  return sayToMenu(ctx, 'Returning to the main subscription menu.');
});
