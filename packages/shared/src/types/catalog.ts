export interface CatalogCategory {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
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
  amazon_star_rating: number | null;
  amazon_ratings_total: number | null;
  is_active: boolean;
  lifetime_qty_sold: number;
  created_at: string;
  updated_at: string;
}

export interface CatalogProductCategory {
  product_id: string;
  category_id: string;
}

export function getProductDisplayName(product: CatalogProduct): string {
  return product.voice_name || product.amazon_name || 'Unknown Product';
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
  return Math.round(product.amazon_price_cents * (1 + markupPercent / 100));
}
