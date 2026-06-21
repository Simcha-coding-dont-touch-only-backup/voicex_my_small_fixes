export interface User {
  id: string;
  name: string;
  email: string | null;
  status: UserStatus;
  is_whitelisted: boolean;
  /**
   * Optional per-user markup percent that overrides the global default markup.
   * Mutually exclusive with `is_whitelisted` (whitelisted users pay the base
   * Amazon price). `null` means fall back to the default system markup.
   */
  custom_markup_percent: number | null;
  created_at: string;
  updated_at: string;
}

export type UserStatus = 'active' | 'frozen' | 'deleted';

/**
 * Resolve the markup percent to apply for a given user. A per-user custom markup
 * takes precedence over the default. For whitelisted users the returned value is
 * irrelevant (pricing short-circuits to the base Amazon price), so callers should
 * still pass the user's `is_whitelisted` flag to `getProductPriceCents`.
 */
export function resolveEffectiveMarkup(
  defaultMarkupPercent: number,
  user: { custom_markup_percent?: number | null } | null | undefined,
): number {
  const custom = user?.custom_markup_percent;
  return custom != null && Number.isFinite(custom) ? custom : defaultMarkupPercent;
}

export interface UserPhone {
  id: string;
  user_id: string;
  phone_number: string;
  is_primary: boolean;
  created_at: string;
}

export interface UserPin {
  id: string;
  user_id: string;
  pin_hash: string;
  updated_at: string;
}

export interface LoginEvent {
  id: string;
  user_id: string;
  phone_number: string;
  success: boolean;
  failure_reason: string | null;
  created_at: string;
}
