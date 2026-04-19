import type { ReactNode } from 'react';
import { getProductPriceCents, type CatalogProduct } from '@voicex/shared';

export function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type PriceProduct = { custom_price_cents: number | null; amazon_price_cents: number | null };

/** Placeholder for custom price (cents) inputs — matches auto-markup when left blank. */
export function customPriceInputPlaceholder(
  amazonPriceCents: number | null | undefined,
  defaultMarkupPercent: number,
): string {
  if (amazonPriceCents == null) return 'Leave blank for auto-markup';
  const suggested = getProductPriceCents(
    { custom_price_cents: null, amazon_price_cents: amazonPriceCents, local_price_cents: null } as CatalogProduct,
    defaultMarkupPercent,
    false,
  );
  if (suggested == null) return 'Leave blank for auto-markup';
  return `${suggested} (Amazon + ${defaultMarkupPercent}% markup)`;
}

/** Explicit custom price, or Amazon + default markup (muted) when unset. */
export function CustomPriceReadonlyDisplay(props: {
  product: PriceProduct;
  defaultMarkupPercent: number;
  /** When no custom price and no computable Amazon price. */
  whenEmpty?: ReactNode;
  /** Append “(Amazon + Default Markup)” after the computed amount (e.g. product detail). */
  showMarkupExplanation?: boolean;
}) {
  const {
    product: p,
    defaultMarkupPercent,
    whenEmpty = <span>-</span>,
    showMarkupExplanation = false,
  } = props;
  if (p.custom_price_cents != null) {
    return <span>{formatUsdFromCents(p.custom_price_cents)}</span>;
  }
  const computed = getProductPriceCents(p as CatalogProduct, defaultMarkupPercent, false);
  if (computed != null) {
    return (
      <span
        className="text-gray-300"
        title="Amazon price + default markup (no custom price set)"
      >
        {formatUsdFromCents(computed)}
        {showMarkupExplanation ? <> (Amazon + Default Markup)</> : null}
      </span>
    );
  }
  return <>{whenEmpty}</>;
}
