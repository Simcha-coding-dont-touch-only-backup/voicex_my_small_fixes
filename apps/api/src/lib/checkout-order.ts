import { getProductDisplayName, type FulfillmentProvider, type PricedCartLine } from '@voicex/shared';
import { supabaseAdmin } from './supabase.js';
import { backfillSyncRunOrder } from './product-sync.js';
import { logCheckoutEvent } from './checkout-logger.js';
import type { CartLineInput } from '@voicex/shared';

export interface PaymentMethodRow {
  id: string;
  user_id: string;
  sola_token: string;
  card_brand: string | null;
  card_last4: string | null;
  is_verified: boolean;
}

export interface PersistCheckoutOrderInput {
  userId: string;
  cartId: string;
  addressId: string;
  paymentMethodId: string;
  paymentMethod: PaymentMethodRow;
  cartItems: CartLineInput[];
  pricedByItemId: Map<string, PricedCartLine>;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  surchargeCents?: number;
  solaRefNum: string;
  fulfillmentProvider: FulfillmentProvider;
  ryeIntentId?: string | null;
  revalidationRunId?: string | null;
  eventCallSid: string;
}

export interface PersistCheckoutOrderResult {
  orderId: number;
  totalCents: number;
  orderItems: Array<{
    product_id: string;
    voicex_id: string;
    product_name: string;
    quantity: number;
    unit_price_cents: number;
    amazon_price_cents: number;
    amazon_asin: string | null;
    amazon_url: string | null;
    local_price_cents: number | null;
    markup_percent: number;
  }>;
}

export async function getActiveFulfillmentProvider(): Promise<FulfillmentProvider> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'active_fulfillment_provider')
    .maybeSingle();
  return data?.value === 'manual' ? 'manual' : 'rye';
}

export async function promoteVerifiedPaymentMethod(
  paymentMethod: PaymentMethodRow,
  eventCallSid: string,
  userId: string,
): Promise<void> {
  if (paymentMethod.is_verified) return;

  await supabaseAdmin
    .from('payment_methods')
    .update({ is_verified: true, is_default: true })
    .eq('id', paymentMethod.id);

  await supabaseAdmin
    .from('payment_methods')
    .update({ is_default: false })
    .eq('user_id', userId)
    .neq('id', paymentMethod.id);

  await logCheckoutEvent({
    callSid: eventCallSid,
    userId,
    eventType: 'payment_method_verified',
    details: {
      payment_method_id: paymentMethod.id,
      card_last4: paymentMethod.card_last4 ?? null,
      source: 'admin',
    },
  });
}

export async function persistCheckoutOrder(
  input: PersistCheckoutOrderInput,
): Promise<PersistCheckoutOrderResult> {
  const {
    userId,
    cartId,
    addressId,
    paymentMethodId,
    paymentMethod,
    cartItems,
    pricedByItemId,
    subtotalCents,
    shippingCents,
    taxCents,
    surchargeCents = 0,
    solaRefNum,
    fulfillmentProvider,
    ryeIntentId = null,
    revalidationRunId = null,
    eventCallSid,
  } = input;

  const totalCents = subtotalCents + shippingCents + taxCents + surchargeCents;

  const { data: order } = await supabaseAdmin
    .from('orders')
    .insert({
      user_id: userId,
      cart_id: cartId,
      address_id: addressId,
      payment_method_id: paymentMethodId,
      rye_checkout_intent_id: fulfillmentProvider === 'rye' ? ryeIntentId : null,
      fulfillment_provider: fulfillmentProvider,
      fulfillment_status: fulfillmentProvider === 'manual' ? 'queued' : 'none',
      status: 'processing',
      subtotal_cents: subtotalCents,
      shipping_cents: shippingCents,
      tax_cents: taxCents,
      total_cents: totalCents,
      card_brand_snapshot: paymentMethod.card_brand ?? null,
      card_last4_snapshot: paymentMethod.card_last4 ?? null,
    })
    .select()
    .single();

  if (!order) throw new Error('Failed to create order');

  if (revalidationRunId) {
    await backfillSyncRunOrder(revalidationRunId, Number(order.id));
  }

  const orderItems = cartItems.map((ci) => {
    const priced = pricedByItemId.get(ci.id)!;
    return {
      order_id: String(order.id),
      product_id: ci.product_id,
      voicex_id: ci.voicex_id,
      product_name: ci.catalog_products
        ? getProductDisplayName(ci.catalog_products)
        : ci.voicex_id || 'Unknown product',
      quantity: ci.quantity,
      unit_price_cents: priced.unitPriceCents!,
      amazon_price_cents: priced.amazonPriceCents ?? 0,
      amazon_asin: ci.catalog_products?.amazon_asin ?? null,
      amazon_url: ci.catalog_products?.amazon_url ?? null,
      local_price_cents: priced.localPriceCents,
      markup_percent: priced.markupPercent,
    };
  });

  await supabaseAdmin.from('order_items').insert(orderItems);
  await supabaseAdmin.from('order_events').insert({
    order_id: String(order.id),
    status: 'processing',
    source: 'system',
    details: {
      action: 'order_created',
      fulfillment_provider: fulfillmentProvider,
      sola_ref_num: solaRefNum,
      source: 'admin_cart_checkout',
    },
  });
  await supabaseAdmin.from('order_holds').insert({
    order_id: String(order.id),
    sola_ref_num: solaRefNum,
    amount_cents: totalCents,
    status: 'held',
  });
  await supabaseAdmin.from('carts').update({ status: 'checked_out' }).eq('id', cartId);

  const itemSnapshots = orderItems.map((oi) => ({
    product_id: oi.product_id,
    voicex_id: oi.voicex_id,
    product_name: oi.product_name,
    quantity: oi.quantity,
    unit_price_cents: oi.unit_price_cents,
    amazon_price_cents: oi.amazon_price_cents,
    amazon_asin: oi.amazon_asin,
    amazon_url: oi.amazon_url,
    local_price_cents: oi.local_price_cents,
    markup_percent: oi.markup_percent,
  }));

  await logCheckoutEvent({
    callSid: eventCallSid,
    userId,
    orderId: String(order.id),
    eventType: 'order_persisted',
    details: {
      order_id: String(order.id),
      fulfillment_provider: fulfillmentProvider,
      sola_ref_num: solaRefNum,
      subtotal_cents: subtotalCents,
      shipping_cents: shippingCents,
      tax_cents: taxCents,
      total_cents: totalCents,
      item_count: itemSnapshots.length,
      source: 'admin_cart_checkout',
      items: itemSnapshots.map((oi) => ({
        ...oi,
        line_total_cents: oi.unit_price_cents * oi.quantity,
      })),
    },
  });

  if (fulfillmentProvider === 'manual') {
    await supabaseAdmin.from('order_events').insert({
      order_id: String(order.id),
      status: 'processing',
      source: 'system',
      details: {
        action: 'manual_fulfillment_queued',
        sola_ref_num: solaRefNum,
        total_cents: totalCents,
        source: 'admin_cart_checkout',
      },
    });

    await logCheckoutEvent({
      callSid: eventCallSid,
      userId,
      orderId: String(order.id),
      eventType: 'manual_fulfillment_queued',
      details: {
        order_id: String(order.id),
        sola_ref_num: solaRefNum,
        total_cents: totalCents,
        item_count: itemSnapshots.length,
        source: 'admin_cart_checkout',
      },
    });
  }

  return {
    orderId: Number(order.id),
    totalCents,
    orderItems: itemSnapshots,
  };
}
