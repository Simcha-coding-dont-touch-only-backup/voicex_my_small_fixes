export interface CatalogCategory {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface CatalogProductImage {
  url: string;
  is_featured: boolean;
}

export type CatalogProductStatus = 'active' | 'inactive' | 'frozen';

export type CatalogProductFrozenSource = 'auto' | 'manual';

export type AmazonAvailabilityStatus =
  | 'in_stock'
  | 'out_of_stock'
  | 'unknown'
  | 'asin_not_found';

const CATALOG_PRODUCT_STATUSES: CatalogProductStatus[] = ['active', 'inactive', 'frozen'];

export function isCatalogProductStatus(value: string): value is CatalogProductStatus {
  return (CATALOG_PRODUCT_STATUSES as string[]).includes(value);
}

export function catalogProductStatusLabel(status: CatalogProductStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'frozen') return 'Frozen';
  return 'Inactive';
}

/** Tailwind classes for status badges in admin UI. */
export function catalogProductStatusBadgeClass(status: CatalogProductStatus): string {
  if (status === 'active') return 'bg-green-100 text-green-700';
  if (status === 'frozen') return 'bg-orange-100 text-orange-700';
  return 'bg-gray-100 text-gray-500';
}

/** Sub-label under Frozen status in admin UI (`null` frozen_source → Manual). */
export function catalogProductFrozenSublabel(
  status: CatalogProductStatus,
  frozenSource: CatalogProductFrozenSource | null | undefined,
): 'Auto' | 'Manual' | null {
  if (status !== 'frozen') return null;
  if (frozenSource === 'auto') return 'Auto';
  return 'Manual';
}

export const ACTIVATE_PRODUCT_BLOCK = {
  ABOVE_LOCAL: "Can't activate: VoiceX price is above local retail",
  MISSING_AMAZON: "Can't activate: Amazon price is not set",
  AMAZON_OUT_OF_STOCK: "Can't activate: product is out of stock on Amazon",
  ASIN_NOT_FOUND: "Can't activate: ASIN not found on Amazon",
} as const;

export function getActivateProductBlockReason(
  product: Pick<
    CatalogProduct,
    'custom_price_cents' | 'amazon_price_cents' | 'local_price_cents' | 'amazon_availability_status'
  >,
  markupPercent: number,
): string | null {
  if (product.amazon_availability_status === 'out_of_stock') {
    return ACTIVATE_PRODUCT_BLOCK.AMAZON_OUT_OF_STOCK;
  }
  if (product.amazon_availability_status === 'asin_not_found') {
    return ACTIVATE_PRODUCT_BLOCK.ASIN_NOT_FOUND;
  }
  if (product.amazon_price_cents == null) {
    return ACTIVATE_PRODUCT_BLOCK.MISSING_AMAZON;
  }
  const effective = getProductPriceCents(
    product as CatalogProduct,
    markupPercent,
    false,
  );
  const local = product.local_price_cents;
  if (effective != null && local != null && effective > local) {
    return ACTIVATE_PRODUCT_BLOCK.ABOVE_LOCAL;
  }
  return null;
}

export interface CatalogProduct {
  id: string;
  voicex_id: string;
  amazon_asin: string;
  amazon_url: string;
  amazon_name: string | null;
  amazon_description: string | null;
  amazon_price_cents: number | null;
  voice_name: string | null;
  voice_description: string | null;
  custom_price_cents: number | null;
  /** Optional per-product markup %. When set and `custom_price_cents` is null, this
   *  overrides the global default markup. Null = use the global default markup. */
  custom_markup_percent: number | null;
  /** Optional average local retail store price (USD cents) for savings messaging vs VoiceX price. */
  local_price_cents: number | null;
  amazon_star_rating: number | null;
  amazon_ratings_total: number | null;
  /** Full Amazon image gallery (hotlinked URLs). Lazy-loaded in lightbox. */
  amazon_image_urls: CatalogProductImage[] | null;
  /** Storage path inside the `product-images` Supabase bucket for the featured thumbnail. */
  thumbnail_path: string | null;
  /** Server-decorated absolute public URL for `thumbnail_path` (admin API only). */
  thumbnail_url?: string | null;
  status: CatalogProductStatus;
  /** Set when `status` is `frozen`: system auto-freeze vs admin manual freeze. */
  frozen_source: CatalogProductFrozenSource | null;
  /** Last Rainforest sync availability classification; null if never synced. */
  amazon_availability_status: AmazonAvailabilityStatus | null;
  lifetime_qty_sold: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface CatalogProductCategory {
  product_id: string;
  category_id: string;
}

export function getProductDisplayName(product: CatalogProduct): string {
  return product.voice_name?.trim() || product.amazon_name || 'Unknown Product';
}

export function getProductDisplayDescription(product: CatalogProduct): string | null {
  return product.voice_description || product.amazon_description || null;
}

export function getProductPriceCents(
  product: CatalogProduct,
  markupPercent: number,
  isWhitelisted: boolean
): number | null {
  if (product.custom_price_cents !== null) {
    return isWhitelisted ? product.amazon_price_cents : product.custom_price_cents;
  }
  if (product.amazon_price_cents === null) return null;
  if (isWhitelisted) return product.amazon_price_cents;
  // A per-product custom markup overrides the global default markup.
  const effectiveMarkup =
    product.custom_markup_percent != null ? product.custom_markup_percent : markupPercent;
  return Math.round(product.amazon_price_cents * (1 + effectiveMarkup / 100));
}

/** Savings vs local retail for one cart line (VoiceX unit price already includes markup). */
export function getCartItemSavingsCents(
  localPriceCents: number | null | undefined,
  unitPriceCents: number,
  quantity: number
): number {
  if (localPriceCents == null) return 0;
  const diff = (localPriceCents - unitPriceCents) * quantity;
  return diff > 0 ? diff : 0;
}
