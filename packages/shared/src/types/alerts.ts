/** Persisted admin alert row (Supabase `admin_alerts`). */
export const ADMIN_ALERT_TYPES = {
  /** Effective VoiceX custom price (manual or auto-markup) exceeds `local_price_cents`. */
  PRODUCT_VOICEX_PRICE_ABOVE_LOCAL: 'product_voicex_price_above_local',
  /** Catalog product has no Amazon price (`amazon_price_cents` is null). */
  PRODUCT_MISSING_AMAZON_PRICE: 'product_missing_amazon_price',
} as const;

export type AdminAlertType = (typeof ADMIN_ALERT_TYPES)[keyof typeof ADMIN_ALERT_TYPES];

/** Alert types tied to catalog product pricing / availability. */
export const PRODUCT_CATALOG_ALERT_TYPES = [
  ADMIN_ALERT_TYPES.PRODUCT_VOICEX_PRICE_ABOVE_LOCAL,
  ADMIN_ALERT_TYPES.PRODUCT_MISSING_AMAZON_PRICE,
] as const;

export function isProductCatalogAlertType(value: string): value is (typeof PRODUCT_CATALOG_ALERT_TYPES)[number] {
  return (PRODUCT_CATALOG_ALERT_TYPES as readonly string[]).includes(value);
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

export interface AdminAlert {
  id: string;
  alert_type: string;
  status: AdminAlertStatus;
  entity_type: string;
  entity_id: string;
  product_id: string;
  title: string;
  message: string | null;
  payload: Record<string, unknown>;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}
