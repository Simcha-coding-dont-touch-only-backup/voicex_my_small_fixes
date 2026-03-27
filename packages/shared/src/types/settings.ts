export interface AppSettings {
  id: string;
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export const SETTING_KEYS = {
  DEFAULT_MARKUP_PERCENT: 'default_markup_percent',
  MAX_CART_ITEMS: 'max_cart_items',
  CALL_TIMEOUT_SECONDS: 'call_timeout_seconds',
  MAX_PIN_RETRIES: 'max_pin_retries',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
