/** Persisted admin alert row (Supabase `admin_alerts`). */
export const ADMIN_ALERT_TYPES = {
  /** Effective VoiceX custom price (manual or auto-markup) exceeds `local_price_cents`. */
  PRODUCT_VOICEX_PRICE_ABOVE_LOCAL: 'product_voicex_price_above_local',
  /** Catalog product has no Amazon price (`amazon_price_cents` is null). */
  PRODUCT_MISSING_AMAZON_PRICE: 'product_missing_amazon_price',
  /** User has made more returns than the high-return threshold. */
  HIGH_RETURNING_USER: 'high_returning_user',
  /** 24h pre-run check found an issue with a pending subscription delivery. */
  SUBSCRIPTION_DELIVERY_ISSUE: 'subscription_delivery_issue',
  /** A subscription delivery failed to process (declined card, etc.). */
  SUBSCRIPTION_FAILED_DELIVERY: 'subscription_failed_delivery',
} as const;

export type AdminAlertType = (typeof ADMIN_ALERT_TYPES)[keyof typeof ADMIN_ALERT_TYPES];

/** Alert types tied to catalog product pricing / availability. */
export const PRODUCT_CATALOG_ALERT_TYPES = [
  ADMIN_ALERT_TYPES.PRODUCT_VOICEX_PRICE_ABOVE_LOCAL,
  ADMIN_ALERT_TYPES.PRODUCT_MISSING_AMAZON_PRICE,
] as const;

/** Alert types scoped to a user (entity_type = 'user', no product_id). */
export const USER_ALERT_TYPES = [ADMIN_ALERT_TYPES.HIGH_RETURNING_USER] as const;

/**
 * Alert types scoped to a subscription delivery (entity_type =
 * 'subscription_delivery', entity_id = delivery id, plus user_id column).
 */
export const SUBSCRIPTION_ALERT_TYPES = [
  ADMIN_ALERT_TYPES.SUBSCRIPTION_DELIVERY_ISSUE,
  ADMIN_ALERT_TYPES.SUBSCRIPTION_FAILED_DELIVERY,
] as const;

export function isProductCatalogAlertType(value: string): value is (typeof PRODUCT_CATALOG_ALERT_TYPES)[number] {
  return (PRODUCT_CATALOG_ALERT_TYPES as readonly string[]).includes(value);
}

export function isUserAlertType(value: string): value is (typeof USER_ALERT_TYPES)[number] {
  return (USER_ALERT_TYPES as readonly string[]).includes(value);
}

export function isSubscriptionAlertType(value: string): value is (typeof SUBSCRIPTION_ALERT_TYPES)[number] {
  return (SUBSCRIPTION_ALERT_TYPES as readonly string[]).includes(value);
}

/** Capitalize the first letter of each word (e.g. "price above local" → "Price Above Local"). */
export function toTitleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function productCatalogAlertTypeLabel(alertType: string): string {
  if (alertType === ADMIN_ALERT_TYPES.PRODUCT_VOICEX_PRICE_ABOVE_LOCAL) {
    return toTitleCase('Price Above Local');
  }
  if (alertType === ADMIN_ALERT_TYPES.PRODUCT_MISSING_AMAZON_PRICE) {
    return toTitleCase('Missing Amazon Price');
  }
  return toTitleCase(alertType);
}

export function adminAlertTypeLabel(alertType: string): string {
  if (alertType === ADMIN_ALERT_TYPES.HIGH_RETURNING_USER) {
    return 'High Returning User';
  }
  if (alertType === ADMIN_ALERT_TYPES.SUBSCRIPTION_DELIVERY_ISSUE) {
    return 'Delivery Issues';
  }
  if (alertType === ADMIN_ALERT_TYPES.SUBSCRIPTION_FAILED_DELIVERY) {
    return 'Failed Deliveries';
  }
  return productCatalogAlertTypeLabel(alertType);
}

/** Issue/type detail codes carried in subscription alert payloads. */
export const SUBSCRIPTION_ALERT_ISSUE_TYPES = {
  EXPIRED_CARD: 'expired_card',
  DECLINED_CARD: 'declined_card',
  PRODUCTS_UNAVAILABLE: 'products_unavailable',
  QTY_UNAVAILABLE: 'qty_unavailable',
  INVALID_ADDRESS: 'invalid_address',
  NO_PAYMENT_METHOD: 'no_payment_method',
  NO_ADDRESS: 'no_address',
  PRODUCT_DISABLED: 'product_disabled',
  OTHER: 'other',
} as const;

export type SubscriptionAlertIssueType =
  (typeof SUBSCRIPTION_ALERT_ISSUE_TYPES)[keyof typeof SUBSCRIPTION_ALERT_ISSUE_TYPES];

export function subscriptionAlertIssueLabel(issueType: string): string {
  switch (issueType) {
    case SUBSCRIPTION_ALERT_ISSUE_TYPES.EXPIRED_CARD:
      return 'Expired Card';
    case SUBSCRIPTION_ALERT_ISSUE_TYPES.DECLINED_CARD:
      return 'Declined Card';
    case SUBSCRIPTION_ALERT_ISSUE_TYPES.PRODUCTS_UNAVAILABLE:
      return 'Products Unavailable';
    case SUBSCRIPTION_ALERT_ISSUE_TYPES.QTY_UNAVAILABLE:
      return 'Quantity Unavailable';
    case SUBSCRIPTION_ALERT_ISSUE_TYPES.INVALID_ADDRESS:
      return 'Incorrect Address';
    case SUBSCRIPTION_ALERT_ISSUE_TYPES.NO_PAYMENT_METHOD:
      return 'No Subscription Card';
    case SUBSCRIPTION_ALERT_ISSUE_TYPES.NO_ADDRESS:
      return 'No Subscription Address';
    case SUBSCRIPTION_ALERT_ISSUE_TYPES.PRODUCT_DISABLED:
      return 'Product Disabled';
    default:
      return toTitleCase(issueType);
  }
}

/** Snapshot stored in `admin_alerts.payload` for subscription alerts. */
export interface SubscriptionAlertPayload {
  delivery_id: string;
  run_id?: string | null;
  week_number: number;
  cycle_date?: string | null;
  issue_type?: string;
  /** What is read to the user on the hotline if they listen to the alert. */
  ivr_message?: string;
  /** Free-form internal admin note (manual alerts). */
  admin_note?: string;
  card_last4?: string | null;
}

export const ADMIN_ALERT_STATUSES = ['new', 'reviewing', 'resolved'] as const;
export type AdminAlertStatus = (typeof ADMIN_ALERT_STATUSES)[number];

/** Snapshot stored in `admin_alerts.payload` for product price vs local alerts. */
export interface ProductVoicexPriceAboveLocalPayload {
  voicex_id: string;
  amazon_asin: string;
  voice_name: string | null;
  amazon_name: string | null;
  effective_custom_price_cents: number;
  custom_price_cents: number | null;
  amazon_price_cents: number | null;
  local_price_cents: number;
  default_markup_percent: number;
}

/** Snapshot stored in `admin_alerts.payload` for missing Amazon price alerts. */
export interface ProductMissingAmazonPricePayload {
  voicex_id: string;
  amazon_asin: string;
  voice_name: string | null;
  amazon_name: string | null;
  custom_price_cents: number | null;
  local_price_cents: number | null;
}

/** Snapshot stored in `admin_alerts.payload` for high-returning-user alerts. */
export interface HighReturningUserPayload {
  user_id: string;
  user_name: string | null;
  return_count: number;
}

export interface AdminAlert {
  id: string;
  alert_type: string;
  status: AdminAlertStatus;
  entity_type: string;
  entity_id: string;
  product_id: string | null;
  /** Set for user-scoped and subscription alerts (clean User filter / joins). */
  user_id: string | null;
  /** User-facing "tag": when the customer heard the alert on the hotline. */
  heard_at: string | null;
  title: string;
  message: string | null;
  payload: Record<string, unknown>;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}
