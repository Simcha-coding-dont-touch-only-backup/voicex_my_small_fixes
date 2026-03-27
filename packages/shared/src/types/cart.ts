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
  unit_price_cents: number;
  amazon_price_cents: number;
  markup_percent: number;
  created_at: string;
  updated_at: string;
}
