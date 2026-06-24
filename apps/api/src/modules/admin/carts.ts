import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import {
  buildUserPricingContextFromRow,
  enrichCartItemsForAdmin,
  liveCartTotalCents,
  loadCartWithPricingById,
  sumPricedLines,
  getUnpricedCartLineIds,
} from '../../lib/cart-pricing.js';
import { getDefaultMarkupPercent } from '../../lib/product-price-alerts.js';
import {
  adminActor,
  revalidateCartAtCheckout,
  type CheckoutCartItem,
} from '../../lib/product-sync.js';
import { calculateManualPricing } from '../../lib/manual-pricing.js';
import { solaAuthOnly } from '../../lib/sola.js';
import {
  getActiveFulfillmentProvider,
  persistCheckoutOrder,
  promoteVerifiedPaymentMethod,
} from '../../lib/checkout-order.js';
import { logCheckoutEvent } from '../../lib/checkout-logger.js';
import type { CartLineInput } from '@voicex/shared';

export const cartsRouter = Router();

const qtySchema = z.object({ quantity: z.coerce.number().int().min(1) });

const CARTS_SORTABLE_COLUMNS = ['created_at', 'status', 'user_id'];

cartsRouter.get('/', async (req, res) => {
  const {
    page = '1',
    per_page = '20',
    user_id,
    status,
    sort_by = 'created_at',
    sort_dir = 'desc',
  } = req.query;

  const sortColumn = CARTS_SORTABLE_COLUMNS.includes(sort_by as string)
    ? (sort_by as string)
    : 'created_at';
  const sortAscending = sort_dir === 'asc';
  const perPage = parseInt(per_page as string);
  const offset = (parseInt(page as string) - 1) * perPage;

  let query = supabaseAdmin
    .from('carts')
    .select(
      '*, users(name, email, is_whitelisted, custom_markup_percent, user_phones(phone_number, is_primary)), cart_items(*, catalog_products(voicex_id, voice_name, amazon_name, amazon_price_cents, custom_price_cents, local_price_cents, status))',
      { count: 'exact' },
    );

  if (status) {
    query = query.eq('status', status as string);
  } else {
    query = query.in('status', ['active', 'abandoned']);
  }

  if (user_id) query = query.eq('user_id', user_id as string);

  const { data, count, error } = await query
    .order(sortColumn, { ascending: sortAscending })
    .range(offset, offset + perPage - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const defaultMarkupPercent = await getDefaultMarkupPercent();
  const enriched = (data || []).map((cart) => {
    const ctx = buildUserPricingContextFromRow(cart.users, defaultMarkupPercent);
    const rawItems = (cart.cart_items || []) as CartLineInput[];
    const cart_items = enrichCartItemsForAdmin(rawItems, ctx);
    return {
      ...cart,
      cart_items,
      live_total_cents: liveCartTotalCents(rawItems, ctx),
    };
  });

  res.json({
    success: true,
    data: enriched,
    total: count || 0,
    page: parseInt(page as string),
    per_page: perPage,
    total_pages: Math.ceil((count || 0) / perPage),
  });
});

cartsRouter.delete('/:cartId', async (req, res) => {
  const { cartId } = req.params;
  const { error } = await supabaseAdmin
    .from('carts')
    .delete()
    .eq('id', cartId)
    .neq('status', 'checked_out');
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true });
});

cartsRouter.patch('/:cartId/items/:itemId', async (req, res) => {
  const { cartId, itemId } = req.params;
  const parsed = qtySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid body' });
    return;
  }

  const { data: cart } = await supabaseAdmin
    .from('carts')
    .select('id, status')
    .eq('id', cartId)
    .single();
  if (!cart) {
    res.status(404).json({ success: false, error: 'Cart not found' });
    return;
  }
  if (cart.status === 'checked_out') {
    res.status(400).json({ success: false, error: 'Cannot modify checked out cart' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('cart_items')
    .update({ quantity: parsed.data.quantity })
    .eq('id', itemId)
    .eq('cart_id', cartId)
    .select()
    .single();
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ success: false, error: 'Cart item not found' });
    return;
  }

  res.json({ success: true, data });
});

cartsRouter.delete('/:cartId/items/:itemId', async (req, res) => {
  const { cartId, itemId } = req.params;
  const { error } = await supabaseAdmin
    .from('cart_items')
    .delete()
    .eq('id', itemId)
    .eq('cart_id', cartId);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  const { count } = await supabaseAdmin
    .from('cart_items')
    .select('id', { count: 'exact', head: true })
    .eq('cart_id', cartId);
  if (count === 0) {
    await supabaseAdmin.from('carts').delete().eq('id', cartId).neq('status', 'checked_out');
  }
  res.json({ success: true });
});

const confirmCheckoutSchema = z.object({
  address_id: z.string().uuid(),
  payment_method_id: z.string().uuid(),
  run_id: z.string().uuid().optional().nullable(),
});

const previewCheckoutSchema = z.object({
  address_id: z.string().uuid(),
});

function adminCheckoutCallSid(cartId: string, adminUserId: string): string {
  return `admin-cart-checkout-${cartId}-${adminUserId}`;
}

cartsRouter.post('/:cartId/checkout/recheck', async (req, res) => {
  const { cartId } = req.params;
  const adminUser = (req as any).adminUser;

  const loaded = await loadCartWithPricingById(cartId);
  if (!loaded) {
    res.status(404).json({ success: false, error: 'Cart not found or has no items' });
    return;
  }
  if (loaded.status !== 'active') {
    res.status(400).json({ success: false, error: 'Only active carts can be checked out' });
    return;
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('is_whitelisted, custom_markup_percent')
    .eq('id', loaded.userId)
    .maybeSingle();

  const cartItems = loaded.items as CheckoutCartItem[];
  const revalidation = await revalidateCartAtCheckout(
    cartItems,
    {
      userId: loaded.userId,
      callerPhone: null,
      isWhitelisted: !!user?.is_whitelisted,
      customMarkupPercent: user?.custom_markup_percent ?? null,
    },
    {
      trigger: 'admin_cart_checkout',
      actor: adminActor(adminUser),
    },
  );

  const reloaded = await loadCartWithPricingById(cartId);
  if (!reloaded || reloaded.items.length === 0) {
    res.status(400).json({
      success: false,
      error: 'All items in this cart are unavailable after re-check',
      data: {
        checkedCount: cartItems.length,
        changedCount: revalidation.priceChanges.length,
        unavailable: revalidation.unavailable,
        priceChanges: revalidation.priceChanges,
        stale: revalidation.stale,
        runId: revalidation.runId,
      },
    });
    return;
  }

  const [{ data: addresses }, { data: paymentMethods }] = await Promise.all([
    supabaseAdmin
      .from('addresses')
      .select('id, label, address1, address2, city, state, zip_code, country, is_default')
      .eq('user_id', loaded.userId)
      .order('is_default', { ascending: false }),
    supabaseAdmin
      .from('payment_methods')
      .select('id, card_last4, card_brand, card_exp_month, card_exp_year, is_default, is_verified')
      .eq('user_id', loaded.userId)
      .eq('is_verified', true)
      .order('is_default', { ascending: false }),
  ]);

  const pricedLines = reloaded.pricedLines.map((line) => ({
    cartItemId: line.cartItemId,
    productId: line.productId,
    voicexId: line.voicexId,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    amazonPriceCents: line.amazonPriceCents,
    localPriceCents: line.localPriceCents,
    markupPercent: line.markupPercent,
    productName:
      reloaded.items.find((i) => i.id === line.cartItemId)?.catalog_products?.voice_name
      || reloaded.items.find((i) => i.id === line.cartItemId)?.catalog_products?.amazon_name
      || line.voicexId,
  }));

  res.json({
    success: true,
    data: {
      cartId,
      userId: loaded.userId,
      checkedCount: cartItems.length,
      changedCount: revalidation.priceChanges.length + revalidation.unavailable.length,
      unavailable: revalidation.unavailable,
      priceChanges: revalidation.priceChanges,
      stale: revalidation.stale,
      unverifiedCount: revalidation.stale.length,
      runId: revalidation.runId,
      hasChanges: revalidation.hasChanges,
      subtotalCents: sumPricedLines(reloaded.pricedLines),
      pricedLines,
      addresses: addresses || [],
      paymentMethods: paymentMethods || [],
    },
  });
});

cartsRouter.post('/:cartId/checkout/preview', async (req, res) => {
  const { cartId } = req.params;
  const parsed = previewCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid body' });
    return;
  }

  const loaded = await loadCartWithPricingById(cartId);
  if (!loaded) {
    res.status(404).json({ success: false, error: 'Cart not found or has no items' });
    return;
  }

  const { data: address } = await supabaseAdmin
    .from('addresses')
    .select('state')
    .eq('id', parsed.data.address_id)
    .eq('user_id', loaded.userId)
    .maybeSingle();

  if (!address) {
    res.status(400).json({ success: false, error: 'Address not found for this user' });
    return;
  }

  const subtotalCents = sumPricedLines(loaded.pricedLines);
  const pricing = await calculateManualPricing(subtotalCents, address.state);

  res.json({ success: true, data: pricing });
});

cartsRouter.post('/:cartId/checkout/confirm', async (req, res) => {
  const { cartId } = req.params;
  const adminUser = (req as any).adminUser;
  const parsed = confirmCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid body' });
    return;
  }

  const fulfillmentProvider = await getActiveFulfillmentProvider();
  if (fulfillmentProvider !== 'manual') {
    res.status(400).json({
      success: false,
      error: 'Admin cart checkout is only supported while manual fulfillment is active',
    });
    return;
  }

  const loaded = await loadCartWithPricingById(cartId);
  if (!loaded) {
    res.status(404).json({ success: false, error: 'Cart not found or has no items' });
    return;
  }
  if (loaded.status !== 'active') {
    res.status(400).json({ success: false, error: 'Only active carts can be checked out' });
    return;
  }

  const unpricedIds = getUnpricedCartLineIds(loaded.pricedLines);
  if (unpricedIds.length > 0) {
    res.status(400).json({
      success: false,
      error: 'One or more cart items have no live price or are unavailable',
      unpriced_item_ids: unpricedIds,
    });
    return;
  }

  const { address_id, payment_method_id, run_id } = parsed.data;

  const [{ data: address }, { data: paymentMethod }] = await Promise.all([
    supabaseAdmin
      .from('addresses')
      .select('*')
      .eq('id', address_id)
      .eq('user_id', loaded.userId)
      .maybeSingle(),
    supabaseAdmin
      .from('payment_methods')
      .select('*')
      .eq('id', payment_method_id)
      .eq('user_id', loaded.userId)
      .maybeSingle(),
  ]);

  if (!address) {
    res.status(400).json({ success: false, error: 'Address not found for this user' });
    return;
  }
  if (!paymentMethod) {
    res.status(400).json({ success: false, error: 'Payment method not found for this user' });
    return;
  }

  const subtotalCents = sumPricedLines(loaded.pricedLines);
  const pricing = await calculateManualPricing(subtotalCents, address.state);
  const totalCents = pricing.totalCents;
  const eventCallSid = adminCheckoutCallSid(cartId, adminUser.id);

  let authResult;
  try {
    authResult = await solaAuthOnly(paymentMethod.sola_token, totalCents);
  } catch (authError) {
    await logCheckoutEvent({
      callSid: eventCallSid,
      userId: loaded.userId,
      eventType: 'sola_auth_failed',
      severity: 'error',
      details: {
        stage: 'auth_only',
        amount_cents: totalCents,
        payment_method_id: payment_method_id,
        card_last4: paymentMethod.card_last4,
        source: 'admin_cart_checkout',
        admin_user_id: adminUser.id,
        error: String(authError),
      },
    });
    res.status(402).json({ success: false, error: 'Card authorization failed' });
    return;
  }

  if (authResult.xResult !== 'A') {
    await logCheckoutEvent({
      callSid: eventCallSid,
      userId: loaded.userId,
      eventType: 'sola_auth_failed',
      severity: 'warn',
      details: {
        stage: 'auth_only',
        amount_cents: totalCents,
        payment_method_id: payment_method_id,
        card_last4: paymentMethod.card_last4,
        source: 'admin_cart_checkout',
        admin_user_id: adminUser.id,
        x_result: authResult.xResult,
        x_error: authResult.xError ?? null,
      },
    });
    res.status(402).json({
      success: false,
      error: authResult.xError || 'Card was declined',
    });
    return;
  }

  await promoteVerifiedPaymentMethod(paymentMethod, eventCallSid, loaded.userId);

  await logCheckoutEvent({
    callSid: eventCallSid,
    userId: loaded.userId,
    eventType: 'sola_auth_succeeded',
    details: {
      stage: 'auth_only',
      amount_cents: totalCents,
      payment_method_id: payment_method_id,
      card_last4: paymentMethod.card_last4,
      sola_ref_num: authResult.xRefNum,
      source: 'admin_cart_checkout',
      admin_user_id: adminUser.id,
    },
  });

  try {
    const result = await persistCheckoutOrder({
      userId: loaded.userId,
      cartId: loaded.cart.id,
      addressId: address_id,
      paymentMethodId: payment_method_id,
      paymentMethod,
      cartItems: loaded.items,
      pricedByItemId: loaded.pricedByItemId,
      subtotalCents,
      shippingCents: pricing.shippingCents,
      taxCents: pricing.taxCents,
      solaRefNum: authResult.xRefNum,
      fulfillmentProvider,
      revalidationRunId: run_id ?? null,
      eventCallSid,
    });

    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_user_id: adminUser.id,
      action: 'admin_cart_checkout',
      entity_type: 'order',
      entity_id: String(result.orderId),
      changes: {
        cart_id: cartId,
        user_id: loaded.userId,
        address_id,
        payment_method_id,
        total_cents: result.totalCents,
        run_id: run_id ?? null,
      },
    });

    res.json({
      success: true,
      data: {
        order_id: result.orderId,
        total_cents: result.totalCents,
        subtotal_cents: subtotalCents,
        shipping_cents: pricing.shippingCents,
        tax_cents: pricing.taxCents,
      },
    });
  } catch (err) {
    console.error('Admin cart checkout failed after auth:', err);
    res.status(500).json({ success: false, error: 'Failed to create order after authorization' });
  }
});
