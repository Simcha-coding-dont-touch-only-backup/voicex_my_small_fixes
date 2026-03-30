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
