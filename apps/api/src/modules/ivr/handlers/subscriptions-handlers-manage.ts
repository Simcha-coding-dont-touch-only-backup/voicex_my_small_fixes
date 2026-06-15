/**
 * Subscription IVR: pause/reactivate deliveries, and set the subscription
 * address and card (use a saved one or enter a new one). New address/card entry
 * mirrors the checkout capture flow but in subscription-scoped handlers so the
 * interactive checkout flow is left untouched.
 */
import { registerHandler } from '../handler-registry.js';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { validateAddressFreeform } from '../../../lib/google-address.js';
import { solaTokenize } from '../../../lib/sola.js';
import { buildCollect } from '../../teltech/teltech-builder.js';
import { pauseDescription } from '@voicex/shared';
import {
  base,
  gather,
  say,
  sayToMenu,
  subscriptionSuccessReturn,
  getSubscriptionCtx,
  weekLabel,
  GATHER_PATH,
} from './subscriptions-shared.js';
import {
  getDeliveries,
  getOrCreateDelivery,
  getDelivery,
  pauseDelivery,
  reactivateDelivery,
  setSubscriptionAddress,
  setSubscriptionCard,
  logSubscriptionEvent,
  getOrCreateSubscription,
} from '../../../lib/subscriptions.js';
import { resolveSubscriptionAlertsForUser } from '../../../lib/subscription-alerts.js';
import { ADMIN_ALERT_TYPES } from '@voicex/shared';

// ============================================================
// Pause / reactivate
// ============================================================

registerHandler('subscriptions_pause_select', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  const deliveries = await getDeliveries(subscription.id);
  const stateByWeek = new Map<number, string>();
  for (const d of deliveries) stateByWeek.set(d.week_number, d.status);
  const digits = ctx.req.body.digits;

  if (digits) {
    if (digits === '5') return say(ctx, 'Pause all deliveries.', 'subscriptions_pause_all_options');
    if (digits === '6') {
      // Reactivate all (only meaningful when all are paused).
      for (const d of deliveries) {
        if (d.status !== 'active') await reactivateDelivery(d, subscription);
      }
      await logSubscriptionEvent({ subscriptionId: subscription.id, eventType: 'all_reactivated', actorType: 'hotline' });
      return sayToMenu(ctx, 'All of your deliveries have been reactivated. Returning to the main subscription menu.');
    }
    const week = parseInt(digits, 10);
    if (week >= 1 && week <= 4) {
      const delivery = await getOrCreateDelivery(subscription.id, week);
      if (delivery.status === 'active') return say(ctx, `Pause your ${weekLabel(week)} Delivery.`, 'subscriptions_pause_options', { week: String(week) });
      return say(ctx, `Reactivate your ${weekLabel(week)} Delivery.`, 'subscriptions_reactivate_confirm', { week: String(week) });
    }
  }

  const parts: string[] = [];
  for (const w of [1, 2, 3, 4]) {
    const st = stateByWeek.get(w) || 'active';
    if (st === 'active') parts.push(`To pause your ${weekLabel(w)} Delivery, press ${w}`);
    else parts.push(`Your ${weekLabel(w)} Delivery is already paused. To reactivate it, press ${w}`);
  }
  const allPaused = [1, 2, 3, 4].every((w) => (stateByWeek.get(w) || 'active') !== 'active');
  const allOpt = allPaused ? ' To reactivate all your deliveries, press 6.' : ' To pause all your deliveries, press 5.';
  return gather(`${parts.join('. ')}.${allOpt} To return to the main subscription menu, press star.`, { ...base(ctx), node_key: 'subscriptions_pause_select' }, { numDigits: 1, timeout: 12 });
});

registerHandler('subscriptions_pause_options', async (ctx) => {
  const week = parseInt(ctx.sessionData.week || '0', 10);
  const digits = ctx.req.body.digits;
  if (!week) return sayToMenu(ctx, 'Returning to the main subscription menu.');

  const choice = digits === '1' ? { type: 'temporary' as const, cycles: 1 }
    : digits === '2' ? { type: 'temporary' as const, cycles: 3 }
    : digits === '3' ? { type: 'permanent' as const, cycles: undefined }
    : null;

  if (!choice) {
    return gather(`Press 1 to pause your ${weekLabel(week)} Delivery for the upcoming monthly cycle. Press 2 to pause it for the next 3 monthly cycles. Press 3 to permanently pause it.`, { ...base(ctx), node_key: 'subscriptions_pause_options', week: String(week) }, { numDigits: 1 });
  }

  const subscription = await getSubscriptionCtx(ctx);
  const delivery = await getOrCreateDelivery(subscription.id, week);
  await pauseDelivery(delivery, choice.type, choice.cycles);
  await logSubscriptionEvent({ subscriptionId: subscription.id, deliveryId: delivery.id, eventType: 'delivery_paused', actorType: 'hotline', details: { week, type: choice.type, cycles: choice.cycles ?? null } });
  return sayToMenu(ctx, `Your ${weekLabel(week)} Delivery has been paused ${pauseDescription(choice.type, choice.cycles ?? null)}. Returning to the main subscription menu.`);
});

registerHandler('subscriptions_pause_all_options', async (ctx) => {
  const digits = ctx.req.body.digits;
  const choice = digits === '1' ? { type: 'temporary' as const, cycles: 1 }
    : digits === '2' ? { type: 'temporary' as const, cycles: 3 }
    : digits === '3' ? { type: 'permanent' as const, cycles: undefined }
    : null;

  if (!choice) {
    return gather('Press 1 to pause all 4 deliveries for the upcoming monthly cycle. Press 2 to pause them for the next 3 monthly cycles. Press 3 to permanently pause them.', { ...base(ctx), node_key: 'subscriptions_pause_all_options' }, { numDigits: 1 });
  }

  const subscription = await getSubscriptionCtx(ctx);
  for (const w of [1, 2, 3, 4]) {
    const delivery = await getOrCreateDelivery(subscription.id, w);
    await pauseDelivery(delivery, choice.type, choice.cycles);
  }
  await logSubscriptionEvent({ subscriptionId: subscription.id, eventType: 'all_paused', actorType: 'hotline', details: { type: choice.type, cycles: choice.cycles ?? null } });
  return sayToMenu(ctx, `All 4 of your deliveries have been paused ${pauseDescription(choice.type, choice.cycles ?? null)}. Returning to the main subscription menu.`);
});

registerHandler('subscriptions_reactivate_confirm', async (ctx) => {
  const week = parseInt(ctx.sessionData.week || '0', 10);
  const digits = ctx.req.body.digits;
  if (!week) return sayToMenu(ctx, 'Returning to the main subscription menu.');
  if (digits !== '1') {
    return gather(`Press 1 to confirm that you would like to reactivate your ${weekLabel(week)} Delivery.`, { ...base(ctx), node_key: 'subscriptions_reactivate_confirm', week: String(week) }, { numDigits: 1 });
  }
  const subscription = await getSubscriptionCtx(ctx);
  const delivery = await getOrCreateDelivery(subscription.id, week);
  await reactivateDelivery(delivery, subscription);
  await logSubscriptionEvent({ subscriptionId: subscription.id, deliveryId: delivery.id, eventType: 'delivery_reactivated', actorType: 'hotline', details: { week } });
  return sayToMenu(ctx, `Your ${weekLabel(week)} Delivery has been reactivated. Returning to the main subscription menu.`);
});

// ============================================================
// Subscription address
// ============================================================

function readAddress(a: any): string {
  return `${a.address1}, ${a.city}, ${a.state} ${a.zip_code}`;
}

registerHandler('subscriptions_address_menu', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  const { data: addresses } = await supabaseAdmin
    .from('addresses')
    .select('*')
    .eq('user_id', subscription.user_id)
    .order('is_default', { ascending: false });

  if (!addresses || addresses.length === 0) {
    return gather('You currently do not have any saved addresses. Press 1 to enter an address.', { ...base(ctx), node_key: 'subscriptions_address_new' }, { numDigits: 1 });
  }

  const current = addresses.find((a) => a.id === subscription.subscription_address_id) || addresses[0];
  return gather(
    `Your current address is ${readAddress(current)}. To use this address, press 1. To use another one of your saved addresses, press 2. To enter a new address, press 3.`,
    { ...base(ctx), node_key: 'subscriptions_address_select', current_address_id: current.id },
    { numDigits: 1 },
  );
});

registerHandler('subscriptions_address_select', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  const digits = ctx.req.body.digits;
  if (digits === '1') {
    const addressId = ctx.sessionData.current_address_id;
    if (addressId) {
      await setSubscriptionAddress(subscription.id, addressId);
      await resolveSubscriptionAlertsForUser(subscription.user_id, [ADMIN_ALERT_TYPES.SUBSCRIPTION_DELIVERY_ISSUE, ADMIN_ALERT_TYPES.SUBSCRIPTION_FAILED_DELIVERY]);
      await logSubscriptionEvent({ subscriptionId: subscription.id, eventType: 'address_changed', actorType: 'hotline', details: { address_id: addressId, source: 'current' } });
    }
    return subscriptionSuccessReturn(ctx, 'That address will now be used for all your deliveries.');
  }
  if (digits === '2') return say(ctx, 'Choose a saved address.', 'subscriptions_address_list');
  if (digits === '3') return say(ctx, 'Enter a new address.', 'subscriptions_address_new');
  return say(ctx, '', 'subscriptions_address_menu');
});

registerHandler('subscriptions_address_list', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  const { data: addresses } = await supabaseAdmin
    .from('addresses')
    .select('*')
    .eq('user_id', subscription.user_id)
    .order('is_default', { ascending: false });
  const list = (addresses || []).slice(0, 9);
  const ids = (ctx.sessionData.address_ids || '').split(',').filter(Boolean);

  const idx = parseInt(ctx.req.body.digits || '', 10) - 1;
  if (ids.length && idx >= 0 && idx < ids.length) {
    await setSubscriptionAddress(subscription.id, ids[idx]);
    await resolveSubscriptionAlertsForUser(subscription.user_id, [ADMIN_ALERT_TYPES.SUBSCRIPTION_DELIVERY_ISSUE, ADMIN_ALERT_TYPES.SUBSCRIPTION_FAILED_DELIVERY]);
    await logSubscriptionEvent({ subscriptionId: subscription.id, eventType: 'address_changed', actorType: 'hotline', details: { address_id: ids[idx], source: 'saved' } });
    return subscriptionSuccessReturn(ctx, 'That address will now be used for all your deliveries.');
  }

  if (list.length === 0) return say(ctx, 'You have no saved addresses.', 'subscriptions_address_new');
  const opts = list.map((a, i) => `Press ${i + 1} for ${readAddress(a)}`);
  return gather(`${opts.join('. ')}.`, { ...base(ctx), node_key: 'subscriptions_address_list', address_ids: list.map((a) => a.id).join(',') }, { numDigits: 1, timeout: 12 });
});

registerHandler('subscriptions_address_new', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const variables = ctx.req.body.variables || {};
  const transcript = ctx.req.body.field_transcript || ctx.req.body.field_value || variables.sub_addr_text || '';

  if (!transcript.trim()) {
    return {
      type: 'actions' as const,
      response: buildCollect({
        type: 'recording', id: 'sub_addr',
        prompt: 'Please say your complete address, including street, apartment or unit number if any, city, state, and zip code.',
        confirm: false, transcribe: true, retry: 3, maxDuration: 25,
        actionPath: GATHER_PATH,
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: 'subscriptions_address_new' },
      }),
    };
  }

  try {
    const v = await validateAddressFreeform(transcript.trim());
    if (v.isValid) {
      const full = v.formattedAddress || `${v.address1}, ${v.city}, ${v.state} ${v.zipCode}`;
      return gather(`Your address is: ${full}. Press 1 to confirm, or press 2 to re-enter.`, {
        ...base(ctx), node_key: 'subscriptions_address_new_save',
        addr_line1: v.address1, addr_line2: v.address2 || '', addr_city: v.city, addr_state: v.state, addr_zip: v.zipCode,
      }, { numDigits: 1 });
    }
  } catch (err) {
    console.error('[subscriptions_address_new] validation error', err);
  }
  return {
    type: 'actions' as const,
    response: buildCollect({
      type: 'recording', id: 'sub_addr',
      prompt: 'Sorry, we could not verify that as a valid address. Please say your complete address again, including street, city, state, and zip code.',
      confirm: false, transcribe: true, retry: 3, maxDuration: 25,
      actionPath: GATHER_PATH,
      sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: 'subscriptions_address_new' },
    }),
  };
});

registerHandler('subscriptions_address_new_save', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  const digits = ctx.req.body.digits;
  if (digits === '2') return say(ctx, 'Re-enter your address.', 'subscriptions_address_new');
  if (digits !== '1') {
    return gather('Press 1 to confirm, or press 2 to re-enter.', { ...base(ctx), node_key: 'subscriptions_address_new_save', addr_line1: ctx.sessionData.addr_line1, addr_line2: ctx.sessionData.addr_line2, addr_city: ctx.sessionData.addr_city, addr_state: ctx.sessionData.addr_state, addr_zip: ctx.sessionData.addr_zip }, { numDigits: 1 });
  }
  const { data: addr } = await supabaseAdmin
    .from('addresses')
    .insert({
      user_id: subscription.user_id,
      address1: ctx.sessionData.addr_line1, address2: ctx.sessionData.addr_line2 || null,
      city: ctx.sessionData.addr_city, state: ctx.sessionData.addr_state, zip_code: ctx.sessionData.addr_zip,
      country: 'US', is_validated: true,
    })
    .select('id')
    .single();
  if (!addr) return sayToMenu(ctx, 'We were unable to save that address. Returning to the main subscription menu.');
  await setSubscriptionAddress(subscription.id, addr.id);
  await resolveSubscriptionAlertsForUser(subscription.user_id, [ADMIN_ALERT_TYPES.SUBSCRIPTION_DELIVERY_ISSUE, ADMIN_ALERT_TYPES.SUBSCRIPTION_FAILED_DELIVERY]);
  await logSubscriptionEvent({ subscriptionId: subscription.id, eventType: 'address_changed', actorType: 'hotline', details: { address_id: addr.id, source: 'new' } });
  return subscriptionSuccessReturn(ctx, 'Your new address will now be used for all your deliveries.');
});

// ============================================================
// Subscription card
// ============================================================

registerHandler('subscriptions_card_menu', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  const { data: cards } = await supabaseAdmin
    .from('payment_methods')
    .select('*')
    .eq('user_id', subscription.user_id)
    .order('is_default', { ascending: false });

  if (!cards || cards.length === 0) {
    return gather('You currently do not have any saved cards. Press 1 to enter a card.', { ...base(ctx), node_key: 'subscriptions_card_number' }, { numDigits: 1 });
  }
  const current = cards.find((c) => c.id === subscription.payment_method_id) || cards[0];
  return gather(
    `Your current card ends in ${current.card_last4}. To use this card, press 1. To use another one of your saved cards, press 2. To enter a new card, press 3.`,
    { ...base(ctx), node_key: 'subscriptions_card_select', current_card_id: current.id },
    { numDigits: 1 },
  );
});

registerHandler('subscriptions_card_select', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  const digits = ctx.req.body.digits;
  if (digits === '1' && ctx.sessionData.current_card_id) {
    await applySubscriptionCard(subscription, ctx.sessionData.current_card_id, 'current');
    return subscriptionSuccessReturn(ctx, 'That card will now be used to pay for all your deliveries.');
  }
  if (digits === '2') return say(ctx, 'Choose a saved card.', 'subscriptions_card_list');
  if (digits === '3') return gather('Please enter your credit card number followed by the pound key.', { ...base(ctx), node_key: 'subscriptions_card_number' }, { finishOnKey: '#', timeout: 15 });
  return say(ctx, '', 'subscriptions_card_menu');
});

registerHandler('subscriptions_card_list', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  const { data: cards } = await supabaseAdmin
    .from('payment_methods')
    .select('*')
    .eq('user_id', subscription.user_id)
    .order('is_default', { ascending: false });
  const list = (cards || []).slice(0, 9);
  const ids = (ctx.sessionData.card_ids || '').split(',').filter(Boolean);
  const idx = parseInt(ctx.req.body.digits || '', 10) - 1;
  if (ids.length && idx >= 0 && idx < ids.length) {
    await applySubscriptionCard(subscription, ids[idx], 'saved');
    return subscriptionSuccessReturn(ctx, 'That card will now be used to pay for all your deliveries.');
  }
  if (list.length === 0) return say(ctx, 'You have no saved cards.', 'subscriptions_card_menu');
  const opts = list.map((c, i) => `Press ${i + 1} for the card ending in ${c.card_last4}`);
  return gather(`${opts.join('. ')}.`, { ...base(ctx), node_key: 'subscriptions_card_list', card_ids: list.map((c) => c.id).join(',') }, { numDigits: 1, timeout: 12 });
});

registerHandler('subscriptions_card_number', async (ctx) => {
  const digits = (ctx.req.body.digits || '').replace(/[^0-9]/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return gather('Invalid card number. Please enter your credit card number followed by the pound key.', { ...base(ctx), node_key: 'subscriptions_card_number' }, { finishOnKey: '#', timeout: 15 });
  }
  return gather('Enter the expiration date as 4 digits, month then year. For example, 0 3 2 8 for March 2028.', { ...base(ctx), node_key: 'subscriptions_card_exp', cc_num: digits }, { numDigits: 4 });
});

registerHandler('subscriptions_card_exp', async (ctx) => {
  const cc_num = ctx.sessionData.cc_num;
  const exp = (ctx.req.body.digits || '').replace(/[^0-9]/g, '');
  const month = parseInt(exp.substring(0, 2), 10);
  if (exp.length !== 4 || month < 1 || month > 12) {
    return gather('Invalid expiration date. Please enter 4 digits, month then year.', { ...base(ctx), node_key: 'subscriptions_card_exp', cc_num }, { numDigits: 4 });
  }
  return gather('Enter the 3 or 4 digit security code from your card, followed by the pound key.', { ...base(ctx), node_key: 'subscriptions_card_cvv', cc_num, cc_exp: exp }, { finishOnKey: '#' });
});

registerHandler('subscriptions_card_cvv', async (ctx) => {
  const { cc_num, cc_exp } = ctx.sessionData;
  const cvv = (ctx.req.body.digits || '').replace(/[^0-9]/g, '');
  if (cvv.length < 3 || cvv.length > 4) {
    return gather('Invalid security code. Please enter the 3 or 4 digit code followed by the pound key.', { ...base(ctx), node_key: 'subscriptions_card_cvv', cc_num, cc_exp }, { finishOnKey: '#' });
  }
  return gather('Enter your 5 digit billing ZIP code.', { ...base(ctx), node_key: 'subscriptions_card_confirm', cc_num, cc_exp, cc_cvv: cvv }, { numDigits: 5 });
});

registerHandler('subscriptions_card_confirm', async (ctx) => {
  const subscription = await getSubscriptionCtx(ctx);
  const { cc_num, cc_exp, cc_cvv } = ctx.sessionData;
  const zip = ctx.req.body.digits || '';
  if (zip.length !== 5) {
    return gather('Please enter a valid 5 digit billing ZIP code.', { ...base(ctx), node_key: 'subscriptions_card_confirm', cc_num, cc_exp, cc_cvv }, { numDigits: 5 });
  }
  try {
    const result = await solaTokenize(cc_num, cc_exp, cc_cvv, zip);
    if (result.xResult !== 'A') {
      return gather(`Your card could not be verified. ${result.xError || ''} Please enter your credit card number followed by the pound key.`, { ...base(ctx), node_key: 'subscriptions_card_number' }, { finishOnKey: '#', timeout: 15 });
    }
    const last4 = cc_num.slice(-4);
    const { data: saved } = await supabaseAdmin
      .from('payment_methods')
      .insert({
        user_id: subscription.user_id,
        sola_token: result.xToken,
        card_last4: last4,
        card_brand: result.xCardType || null,
        card_exp_month: parseInt(cc_exp.substring(0, 2), 10),
        card_exp_year: parseInt(cc_exp.substring(2, 4), 10) + 2000,
      })
      .select('id')
      .single();
    if (!saved) throw new Error('Failed to save card');
    await applySubscriptionCard(subscription, saved.id, 'new');
    return subscriptionSuccessReturn(ctx, `Your card ending in ${last4} will now be used to pay for all your deliveries.`);
  } catch (err) {
    console.error('[subscriptions_card_confirm] tokenize error', err);
    return gather('There was an error processing your card. Please enter your credit card number followed by the pound key.', { ...base(ctx), node_key: 'subscriptions_card_number' }, { finishOnKey: '#', timeout: 15 });
  }
});

async function applySubscriptionCard(subscription: { id: string; user_id: string }, cardId: string, source: string) {
  await setSubscriptionCard(subscription.id, cardId);
  await resolveSubscriptionAlertsForUser(subscription.user_id, [ADMIN_ALERT_TYPES.SUBSCRIPTION_DELIVERY_ISSUE, ADMIN_ALERT_TYPES.SUBSCRIPTION_FAILED_DELIVERY]);
  await logSubscriptionEvent({ subscriptionId: subscription.id, eventType: 'card_changed', actorType: 'hotline', details: { payment_method_id: cardId, source } });
}
