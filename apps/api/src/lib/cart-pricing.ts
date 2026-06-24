import {
  buildCartPricingContext,
  findUnpricedCartLineIds,
  priceCartLine,
  priceCartLines,
  sumPricedLines,
  type CartLineInput,
  type CartPricingContext,
  type PricedCartLine,
} from '@voicex/shared';
import { supabaseAdmin } from './supabase.js';
import { getDefaultMarkupPercent } from './product-price-alerts.js';

export type { CartPricingContext, PricedCartLine };

export async function loadUserPricingContext(userId: string): Promise<CartPricingContext> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('is_whitelisted, custom_markup_percent')
    .eq('id', userId)
    .maybeSingle();

  const defaultMarkupPercent = await getDefaultMarkupPercent();
  return buildCartPricingContext(user, defaultMarkupPercent);
}

export function buildUserPricingContextFromRow(
  user: { is_whitelisted?: boolean; custom_markup_percent?: number | null } | null | undefined,
  defaultMarkupPercent: number,
): CartPricingContext {
  return buildCartPricingContext(user, defaultMarkupPercent);
}

export function priceCartItems(
  cartItems: CartLineInput[],
  ctx: CartPricingContext,
): PricedCartLine[] {
  return priceCartLines(cartItems, ctx);
}

export function pricedLinesByCartItemId(lines: PricedCartLine[]): Map<string, PricedCartLine> {
  return new Map(lines.map((line) => [line.cartItemId, line]));
}

export interface ActiveCartWithPricing {
  cart: { id: string };
  items: CartLineInput[];
  pricedLines: PricedCartLine[];
  pricedByItemId: Map<string, PricedCartLine>;
  ctx: CartPricingContext;
}

export async function loadActiveCartWithPricing(userId: string): Promise<ActiveCartWithPricing | null> {
  const { data: cart } = await supabaseAdmin
    .from('carts')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (!cart) return null;

  const { data: items } = await supabaseAdmin
    .from('cart_items')
    .select('*, catalog_products(*)')
    .eq('cart_id', cart.id);

  if (!items || items.length === 0) return null;

  const ctx = await loadUserPricingContext(userId);
  const pricedLines = priceCartItems(items as CartLineInput[], ctx);

  return {
    cart,
    items: items as CartLineInput[],
    pricedLines,
    pricedByItemId: pricedLinesByCartItemId(pricedLines),
    ctx,
  };
}

export function getUnpricedCartLineIds(pricedLines: PricedCartLine[]): string[] {
  return findUnpricedCartLineIds(pricedLines);
}

export interface AdminEnrichedCartItem extends CartLineInput {
  live_unit_price_cents: number | null;
  live_amazon_price_cents: number | null;
  live_local_price_cents: number | null;
  live_markup_percent: number;
}

export function enrichCartItemsForAdmin(
  cartItems: CartLineInput[],
  ctx: CartPricingContext,
): AdminEnrichedCartItem[] {
  return cartItems.map((item) => {
    const priced = priceCartLine(item, ctx);
    return {
      ...item,
      live_unit_price_cents: priced.unitPriceCents,
      live_amazon_price_cents: priced.amazonPriceCents,
      live_local_price_cents: priced.localPriceCents,
      live_markup_percent: priced.markupPercent,
    };
  });
}

export function liveCartTotalCents(cartItems: CartLineInput[], ctx: CartPricingContext): number {
  return sumPricedLines(priceCartLines(cartItems, ctx));
}

export interface CartWithPricing extends ActiveCartWithPricing {
  userId: string;
  status: string;
}

export async function loadCartWithPricingById(cartId: string): Promise<CartWithPricing | null> {
  const { data: cart } = await supabaseAdmin
    .from('carts')
    .select('id, user_id, status')
    .eq('id', cartId)
    .maybeSingle();

  if (!cart) return null;

  const { data: items } = await supabaseAdmin
    .from('cart_items')
    .select('*, catalog_products(*)')
    .eq('cart_id', cart.id);

  if (!items || items.length === 0) return null;

  const ctx = await loadUserPricingContext(cart.user_id);
  const pricedLines = priceCartItems(items as CartLineInput[], ctx);

  return {
    cart: { id: cart.id },
    userId: cart.user_id,
    status: cart.status,
    items: items as CartLineInput[],
    pricedLines,
    pricedByItemId: pricedLinesByCartItemId(pricedLines),
    ctx,
  };
}

export { sumPricedLines } from '@voicex/shared';
