import { SETTING_KEYS, US_STATE_CODES } from '@voicex/shared';
import { supabaseAdmin } from './supabase.js';

const MANUAL_SETTING_KEYS = [
  SETTING_KEYS.MANUAL_DEFAULT_TAX_PERCENT,
  SETTING_KEYS.MANUAL_STATE_TAX_RATES,
  SETTING_KEYS.MANUAL_FREE_SHIPPING_CUTOFF,
  SETTING_KEYS.MANUAL_SHIPPING_FEE,
] as const;

const VALID_STATE_CODES = new Set<string>(US_STATE_CODES);

export interface ManualPricingResult {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  taxRatePercent: number;
  taxRateSource: 'state_override' | 'default';
  stateCode: string | null;
  freeShippingCutoffCents: number;
  shippingFeeCents: number;
}

function parseNumber(value: string | null | undefined): number {
  const n = Number(String(value ?? '').trim().replace(/^\$/, '').replace(/%$/, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function dollarsToCents(value: string | null | undefined): number {
  return Math.round(parseNumber(value) * 100);
}

function parseStateTaxRates(value: string | null | undefined): Record<string, number> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const rates: Record<string, number> = {};
    for (const [state, rate] of Object.entries(parsed)) {
      const code = state.trim().toUpperCase();
      if (!VALID_STATE_CODES.has(code)) continue;

      const rawRate = String(rate ?? '').trim().replace(/%$/, '');
      if (!rawRate) continue;
      const n = Number(rawRate);
      if (Number.isFinite(n) && n >= 0) rates[code] = n;
    }
    return rates;
  } catch {
    return {};
  }
}

function normalizeStateCode(value: unknown): string | null {
  const code = String(value ?? '').trim().toUpperCase();
  return VALID_STATE_CODES.has(code) ? code : null;
}

export async function calculateManualPricing(
  subtotalCents: number,
  addressState: unknown
): Promise<ManualPricingResult> {
  const { data, error } = await supabaseAdmin
    .from('settings')
    .select('key, value')
    .in('key', [...MANUAL_SETTING_KEYS]);

  if (error) {
    throw new Error(`Failed to load manual fulfillment pricing settings: ${error.message}`);
  }

  const settings = new Map((data || []).map((row) => [row.key, row.value as string]));
  const defaultTaxPercent = parseNumber(settings.get(SETTING_KEYS.MANUAL_DEFAULT_TAX_PERCENT));
  const stateRates = parseStateTaxRates(settings.get(SETTING_KEYS.MANUAL_STATE_TAX_RATES));
  const stateCode = normalizeStateCode(addressState);
  const stateTaxPercent = stateCode ? stateRates[stateCode] : undefined;
  const taxRatePercent = stateTaxPercent ?? defaultTaxPercent;
  const taxRateSource = stateTaxPercent == null ? 'default' : 'state_override';
  const freeShippingCutoffCents = dollarsToCents(settings.get(SETTING_KEYS.MANUAL_FREE_SHIPPING_CUTOFF));
  const shippingFeeCents = dollarsToCents(settings.get(SETTING_KEYS.MANUAL_SHIPPING_FEE));
  const shippingCents = subtotalCents >= freeShippingCutoffCents ? 0 : shippingFeeCents;
  const taxCents = Math.round(subtotalCents * (taxRatePercent / 100));

  return {
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
    taxRatePercent,
    taxRateSource,
    stateCode,
    freeShippingCutoffCents,
    shippingFeeCents,
  };
}
