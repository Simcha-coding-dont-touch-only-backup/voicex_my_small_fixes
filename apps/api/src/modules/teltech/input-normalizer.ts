import type { IvrIntent } from '@voicex/shared';

interface NormalizedInput {
  type: 'dtmf';
  raw: string;
  matchedIntent: string | null;
}

export function normalizeInput(
  digits: string | undefined,
  intents: IvrIntent[]
): NormalizedInput {
  if (digits) {
    const matched = intents.find((i) => i.dtmf_key === digits);
    return {
      type: 'dtmf',
      raw: digits,
      matchedIntent: matched?.name || null,
    };
  }

  return {
    type: 'dtmf',
    raw: '',
    matchedIntent: null,
  };
}

// Canonical width of a stored voicex_id. When this changes (e.g. once we
// pass 9,999,999 products), update VOICEX_ID_WIDTH and run a backfill
// migration to re-pad the catalog_products / cart_items / order_items rows.
export const VOICEX_ID_WIDTH = 7;

// Normalize a caller-dialed catalog number to the canonical zero-padded
// form stored in the database. Strips leading zeros first so that callers
// can dial either "2410" or "0002410" interchangeably, then re-pads to
// VOICEX_ID_WIDTH. Returns the original input if it is empty or contains
// any non-digit characters (so callers of this helper can still detect
// invalid input).
export function normalizeVoicexId(digits: string | undefined | null): string {
  if (!digits) return '';
  if (!/^\d+$/.test(digits)) return digits;
  const stripped = digits.replace(/^0+/, '') || '0';
  return stripped.padStart(VOICEX_ID_WIDTH, '0');
}

