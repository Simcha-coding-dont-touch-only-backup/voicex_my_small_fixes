import { normalizeOrderNumberInput } from '@voicex/shared';

/** Resolve route/query order id; rejects non-numeric or all-zero input. */
export function orderIdFromParam(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  const n = normalizeOrderNumberInput(raw);
  return n === '' ? null : n;
}
