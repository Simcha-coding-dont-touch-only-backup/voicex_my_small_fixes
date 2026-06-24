export interface Cart {
  id: string;
  user_id: string;
  status: CartStatus;
  created_at: string;
  updated_at: string;
}

export type CartStatus = 'active' | 'checked_out' | 'abandoned';

export interface CartItem {
  id: string;
  cart_id: string;
  product_id: string;
  voicex_id: string;
  quantity: number;
  /** Add-to-cart snapshot of the charged unit price; not authoritative for active carts. */
  unit_price_cents: number;
  /** Add-to-cart snapshot of catalog Amazon price; not authoritative for active carts. */
  amazon_price_cents: number;
  /** Add-to-cart snapshot of catalog_products.local_price_cents. */
  local_price_cents?: number | null;
  /** Add-to-cart snapshot of markup applied when the line was first added. */
  markup_percent: number;
  created_at: string;
  updated_at: string;
}
