/** Minimum valid order id (5-digit customer-facing numbers start here). */
export const ORDER_ID_MIN = 10001;

/**
 * Keypad / URL order id input: keep digits only, strip leading zeros (IVR + admin).
 * Returns empty string if there are no digits.
 */
export function normalizeOrderNumberInput(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.replace(/^0+/, '');
}

/** Display order number (same as stored id; naturally 5 digits from ORDER_ID_MIN). */
export function formatOrderNumber(id: string | number): string {
  return String(id);
}

/** Route/query order id: same rules as admin API — rejects empty raw and all-zero / non-digit-only input after normalization. */
export function orderIdFromParam(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  const n = normalizeOrderNumberInput(raw);
  if (n === '') return null;
  const id = BigInt(n);
  if (id < BigInt(ORDER_ID_MIN)) return null;
  return n;
}

/** Separator between spoken digits; commas add a natural TTS pause on TelTech IVR. */
export const ORDER_ID_SPEECH_DIGIT_SEPARATOR = ',  ';

/** Comma-separated digits for phone TTS (avoids "twelve million" style misreads; commas slow pacing). */
export function formatOrderIdForSpeech(id: string | number): string {
  const normalized = normalizeOrderNumberInput(String(id));
  if (!normalized) return '';
  return normalized.split('').join(ORDER_ID_SPEECH_DIGIT_SEPARATOR);
}
