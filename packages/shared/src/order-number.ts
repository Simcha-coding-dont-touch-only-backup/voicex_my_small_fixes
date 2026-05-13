/**
 * Keypad / URL order id input: keep digits only, strip leading zeros (IVR + admin).
 * Returns empty string if there are no digits.
 */
export function normalizeOrderNumberInput(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.replace(/^0+/, '');
}

/** Route/query order id: same rules as admin API — rejects empty raw and all-zero / non-digit-only input after normalization. */
export function orderIdFromParam(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  const n = normalizeOrderNumberInput(raw);
  return n === '' ? null : n;
}

/** Space-separated digits for phone TTS (avoids "twelve million" style misreads). */
export function formatOrderIdForSpeech(id: string | number): string {
  const normalized = normalizeOrderNumberInput(String(id));
  if (!normalized) return '';
  return normalized.split('').join(' ');
}
