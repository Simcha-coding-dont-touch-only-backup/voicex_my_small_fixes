export interface Order {
  /** BIGINT primary key; JSON may be string for safe integer round-trip. */
  id: string;
  user_id: string;
  cart_id: string;
  address_id: string;
  payment_method_id: string | null;
  /** Snapshot of card brand at order placement; survives payment method deletion. */
  card_brand_snapshot: string | null;
  /** Snapshot of card last4 at order placement; survives payment method deletion. */
  card_last4_snapshot: string | null;
  rye_checkout_intent_id: string | null;
  fulfillment_provider: FulfillmentProvider;
  fulfillment_status: FulfillmentStatus;
  external_order_id: string | null;
  fulfillment_notes: string | null;
  fulfilled_by: string | null;
  fulfilled_at: string | null;
  status: OrderStatus;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  estimated_delivery: string | null;
  order_fulfillment_etas?: OrderFulfillmentEta[];
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

export type FulfillmentProvider = 'rye' | 'manual';

export type FulfillmentStatus =
  | 'none'
  | 'queued'
  | 'ordered'
  | 'needs_review'
  | 'cancelled';

export interface OrderFulfillmentEta {
  id: string;
  order_id: string;
  eta_date: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  voicex_id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  amazon_price_cents: number;
  amazon_asin: string | null;
  amazon_url: string | null;
  /** Snapshot from cart line at order placement. */
  local_price_cents?: number | null;
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
