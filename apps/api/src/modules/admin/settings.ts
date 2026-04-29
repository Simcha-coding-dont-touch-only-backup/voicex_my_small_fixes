import { Router } from 'express';
import { SETTING_KEYS, US_STATE_CODES } from '@voicex/shared';
import { supabaseAdmin } from '../../lib/supabase.js';

export const settingsRouter = Router();

const PERCENT_SETTING_KEYS = new Set<string>([
  SETTING_KEYS.DEFAULT_MARKUP_PERCENT,
  SETTING_KEYS.MANUAL_DEFAULT_TAX_PERCENT,
]);

const MONEY_SETTING_KEYS = new Set<string>([
  SETTING_KEYS.MANUAL_FREE_SHIPPING_CUTOFF,
  SETTING_KEYS.MANUAL_SHIPPING_FEE,
]);

const VALID_STATE_CODES = new Set<string>(US_STATE_CODES);

function normalizeDecimalSetting(
  value: unknown,
  label: string,
  allowCurrencySymbol = false,
  maxDecimalPlaces = 2
): string {
  const raw = String(value ?? '').trim();
  const stripped = allowCurrencySymbol
    ? raw.replace(/^\$/, '')
    : raw.replace(/%$/, '');
  const decimalPattern = new RegExp(`^\\d+(\\.\\d{1,${maxDecimalPlaces}})?$`);

  if (!stripped) return '0';
  if (!decimalPattern.test(stripped)) {
    throw new Error(`${label} must be a non-negative number with up to ${maxDecimalPlaces} decimal places.`);
  }

  return String(Number(stripped));
}

function normalizeStateTaxRates(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : value;
  let parsed: unknown = raw || {};

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Manual state tax rates must be valid JSON.');
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Manual state tax rates must be a JSON object keyed by state code.');
  }

  const normalized: Record<string, string> = {};
  for (const [state, rate] of Object.entries(parsed)) {
    const code = state.trim().toUpperCase();
    if (!VALID_STATE_CODES.has(code)) {
      throw new Error(`Invalid state code for manual tax override: ${state}`);
    }

    const rawRate = String(rate ?? '').trim().replace(/%$/, '');
    if (!rawRate) continue;
    if (!/^\d+(\.\d{1,3})?$/.test(rawRate)) {
      throw new Error(`Manual tax rate for ${code} must be a non-negative number with up to 3 decimal places.`);
    }

    normalized[code] = String(Number(rawRate));
  }

  return JSON.stringify(normalized);
}

function normalizeSettingValue(key: string, value: unknown): string {
  if (key === SETTING_KEYS.MANUAL_STATE_TAX_RATES) {
    return normalizeStateTaxRates(value);
  }

  if (PERCENT_SETTING_KEYS.has(key)) {
    return normalizeDecimalSetting(value, key, false, 3);
  }

  if (MONEY_SETTING_KEYS.has(key)) {
    return normalizeDecimalSetting(value, key, true);
  }

  return String(value ?? '');
}

settingsRouter.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('settings')
    .select('*')
    .order('key');

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data });
});

settingsRouter.patch('/:key', async (req, res) => {
  let value: string;
  try {
    value = normalizeSettingValue(req.params.key, req.body.value);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error?.message || 'Invalid setting value' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', req.params.key)
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'update_setting',
    entity_type: 'setting',
    entity_id: req.params.key,
    changes: { value },
  });

  res.json({ success: true, data });
});
