import type { CartItem } from './types/cart.js';
import type { CatalogProduct } from './types/catalog.js';
import { getProductPriceCents } from './types/catalog.js';
import { resolveEffectiveMarkup } from './types/user.js';

export interface CartPricingContext {
  defaultMarkupPercent: number;
  isWhitelisted: boolean;
  customMarkupPercent: number | null;
}

export interface CartLineInput {
  id: string;
  product_id: string;
  voicex_id: string;
  quantity: number;
  unit_price_cents: number;
  amazon_price_cents: number;
  local_price_cents?: number | null;
  markup_percent: number;
  catalog_products: CatalogProduct | null;
}

export interface PricedCartLine {
  cartItemId: string;
  productId: string;
  voicexId: string;
  quantity: number;
  unitPriceCents: number | null;
  amazonPriceCents: number | null;
  localPriceCents: number | null;
  markupPercent: number;
  snapshotUnitPriceCents: number;
  snapshotAmazonPriceCents: number;
  snapshotLocalPriceCents: number | null;
  snapshotMarkupPercent: number;
  catalog_products: CatalogProduct | null;
}

export function buildCartPricingContext(
  user: { is_whitelisted?: boolean; custom_markup_percent?: number | null } | null | undefined,
  defaultMarkupPercent: number,
): CartPricingContext {
  return {
    defaultMarkupPercent,
    isWhitelisted: !!user?.is_whitelisted,
    customMarkupPercent: user?.custom_markup_percent ?? null,
  };
}

export function effectiveMarkupPercent(ctx: CartPricingContext): number {
  return resolveEffectiveMarkup(ctx.defaultMarkupPercent, {
    custom_markup_percent: ctx.customMarkupPercent,
  });
}

export function priceCartLine(item: CartLineInput, ctx: CartPricingContext): PricedCartLine {
  const product = item.catalog_products;
  const markupPercent = ctx.isWhitelisted ? 0 : effectiveMarkupPercent(ctx);

  let unitPriceCents: number | null = null;
  let amazonPriceCents: number | null = null;

  if (product && product.status === 'active') {
    amazonPriceCents = product.amazon_price_cents;
    unitPriceCents = getProductPriceCents(product, markupPercent, ctx.isWhitelisted);
  }

  return {
    cartItemId: item.id,
    productId: item.product_id,
    voicexId: item.voicex_id,
    quantity: item.quantity,
    unitPriceCents,
    amazonPriceCents,
    localPriceCents: product?.local_price_cents ?? null,
    markupPercent,
    snapshotUnitPriceCents: item.unit_price_cents,
    snapshotAmazonPriceCents: item.amazon_price_cents,
    snapshotLocalPriceCents: item.local_price_cents ?? null,
    snapshotMarkupPercent: item.markup_percent,
    catalog_products: product,
  };
}

export function priceCartLines(items: CartLineInput[], ctx: CartPricingContext): PricedCartLine[] {
  return items.map((item) => priceCartLine(item, ctx));
}

export function sumPricedLines(lines: PricedCartLine[]): number {
  return lines.reduce((sum, line) => {
    if (line.unitPriceCents == null) return sum;
    return sum + line.unitPriceCents * line.quantity;
  }, 0);
}

export function sumPricedLinesAmazonBase(lines: PricedCartLine[]): number {
  return lines.reduce((sum, line) => {
    if (line.amazonPriceCents == null) return sum;
    return sum + line.amazonPriceCents * line.quantity;
  }, 0);
}

/** Returns cart item ids whose live unit price could not be computed. */
export function findUnpricedCartLineIds(lines: PricedCartLine[]): string[] {
  return lines.filter((line) => line.unitPriceCents == null).map((line) => line.cartItemId);
}

/** Narrow CartItem rows joined with catalog for pricing. */
export type CartItemWithCatalog = CartItem & { catalog_products: CatalogProduct | null };
