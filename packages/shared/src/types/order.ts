export interface Order {
  id: string;
  user_id: string;
  cart_id: string;
  address_id: string;
  payment_method_id: string;
  rye_checkout_intent_id: string | null;
  status: OrderStatus;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  estimated_delivery: string | null;
  created_at: string;
  updated_at: string;
}

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  voicex_id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  amazon_price_cents: number;
  markup_percent: number;
  created_at: string;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  status: OrderStatus;
  source: 'system' | 'rye_webhook' | 'admin';
  details: Record<string, unknown> | null;
  created_at: string;
}
