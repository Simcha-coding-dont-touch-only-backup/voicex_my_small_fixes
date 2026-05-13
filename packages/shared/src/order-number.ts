/**
 * Keypad / URL order id input: keep digits only, strip leading zeros (IVR + admin).
 * Returns empty string if there are no digits.
 */
export function normalizeOrderNumberInput(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.replace(/^0+/, '');
}

/** Space-separated digits for phone TTS (avoids "twelve million" style misreads). */
export function formatOrderIdForSpeech(id: string | number): string {
  const normalized = normalizeOrderNumberInput(String(id));
  if (!normalized) return '';
  return normalized.split('').join(' ');
}
