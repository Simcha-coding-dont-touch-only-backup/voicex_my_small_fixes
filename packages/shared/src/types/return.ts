import type { OrderStatus } from './order.js';

/** Lifecycle of an order return. */
export const RETURN_STATUSES = [
  'pending',
  'processing',
  'complete',
  'cancelled',
  'rejected',
  'deleted',
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/**
 * Statuses that reserve returned quantity and count toward financials and the
 * user return history / high-return alerts.
 */
export const ACTIVE_RETURN_STATUSES = ['pending', 'processing', 'complete'] as const;

/**
 * Statuses that release reserved quantity and are excluded from every
 * calculation (financials, user counts, reports).
 */
export const VOID_RETURN_STATUSES = ['cancelled', 'rejected', 'deleted'] as const;

export function isActiveReturnStatus(status: string): boolean {
  return (ACTIVE_RETURN_STATUSES as readonly string[]).includes(status);
}

export function isVoidReturnStatus(status: string): boolean {
  return (VOID_RETURN_STATUSES as readonly string[]).includes(status);
}

/** Order statuses eligible to be returned. */
export const RETURNABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  'pending',
  'processing',
  'awaiting_confirmation',
  'confirmed',
  'completed',
];

export function isReturnableOrderStatus(status: string): status is OrderStatus {
  return (RETURNABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

/** A return may only be created within this many days of the order date. */
export const RETURN_WINDOW_DAYS = 30;

/** A user with strictly more than this many returns triggers the high-return alert. */
export const HIGH_RETURN_ALERT_THRESHOLD = 5;
/** Row turns light orange in the admin Users table above this many returns. */
export const RETURN_ROW_WARN_THRESHOLD = 3;
/** Row turns light red in the admin Users table above this many returns. */
export const RETURN_ROW_DANGER_THRESHOLD = 5;

export interface OrderReturn {
  /** BIGINT primary key; JSON may be string for safe integer round-trip. */
  id: string;
  order_id: string;
  user_id: string;
  status: ReturnStatus;
  source: 'ivr' | 'admin';
  /** What the customer paid for the returned items (unit_price * qty), pre-tax. */
  item_subtotal_cents: number;
  /** Tax refunded to the customer; seeded proportionally, admin-editable. */
  tax_refund_cents: number;
  /** Amount expected/received back from Amazon (amazon_price * qty), admin-editable. */
  amazon_refund_cents: number;
  refunded: boolean;
  refunded_at: string | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  return_items?: OrderReturnItem[];
  return_fees?: OrderReturnFee[];
}

export interface OrderReturnItem {
  id: string;
  return_id: string;
  order_item_id: string;
  product_id: string | null;
  voicex_id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  amazon_price_cents: number;
  created_at: string;
}

export interface OrderReturnFee {
  id: string;
  return_id: string;
  name: string;
  amount_cents: number;
  created_at: string;
}

/**
 * Tax refunded for a partial return, proportional to the share of the order
 * subtotal being returned. Rounded to whole cents. Shipping is never refunded.
 */
export function computeProportionalTaxRefundCents(
  orderTaxCents: number,
  orderSubtotalCents: number,
  returnedSubtotalCents: number,
): number {
  if (orderSubtotalCents <= 0 || orderTaxCents <= 0 || returnedSubtotalCents <= 0) return 0;
  const ratio = Math.min(1, returnedSubtotalCents / orderSubtotalCents);
  return Math.round(orderTaxCents * ratio);
}

/** Total cash refunded to the customer for a return (items + tax, no shipping). */
export function customerRefundCents(ret: Pick<OrderReturn, 'item_subtotal_cents' | 'tax_refund_cents'>): number {
  return ret.item_subtotal_cents + ret.tax_refund_cents;
}

/**
 * Profit impact (a positive number representing lost profit) of a completed
 * return: the VoiceX margin given back (items refunded minus Amazon refund)
 * plus any extra fees we incurred handling the return.
 */
export function returnProfitReductionCents(
  ret: Pick<OrderReturn, 'item_subtotal_cents' | 'amazon_refund_cents'>,
  totalFeesCents: number,
): number {
  return ret.item_subtotal_cents - ret.amazon_refund_cents + totalFeesCents;
}
