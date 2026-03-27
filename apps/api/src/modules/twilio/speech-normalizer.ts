import type { IvrIntent } from '@voicex/shared';

interface NormalizedInput {
  type: 'dtmf' | 'speech';
  raw: string;
  matchedIntent: string | null;
  confidence: number;
}

export function normalizeInput(
  digits: string | undefined,
  speechResult: string | undefined,
  confidence: string | undefined,
  intents: IvrIntent[]
): NormalizedInput {
  if (digits) {
    const matched = intents.find((i) => i.dtmf_key === digits);
    return {
      type: 'dtmf',
      raw: digits,
      matchedIntent: matched?.name || null,
      confidence: 1.0,
    };
  }

  if (speechResult) {
    const speech = speechResult.toLowerCase().trim();
    const conf = parseFloat(confidence || '0');

    for (const intent of intents) {
      for (const phrase of intent.speech_phrases) {
        if (
          speech === phrase.toLowerCase() ||
          speech.includes(phrase.toLowerCase()) ||
          levenshteinSimilarity(speech, phrase.toLowerCase()) > 0.75
        ) {
          return {
            type: 'speech',
            raw: speechResult,
            matchedIntent: intent.name,
            confidence: conf,
          };
        }
      }
    }

    const digitMatch = speechToDigit(speech);
    if (digitMatch) {
      const matched = intents.find((i) => i.dtmf_key === digitMatch);
      if (matched) {
        return {
          type: 'speech',
          raw: speechResult,
          matchedIntent: matched.name,
          confidence: conf,
        };
      }
    }

    return {
      type: 'speech',
      raw: speechResult,
      matchedIntent: null,
      confidence: conf,
    };
  }

  return {
    type: 'dtmf',
    raw: '',
    matchedIntent: null,
    confidence: 0,
  };
}

const SPOKEN_DIGITS: Record<string, string> = {
  zero: '0', oh: '0',
  one: '1', won: '1',
  two: '2', to: '2', too: '2',
  three: '3',
  four: '4', for: '4', fore: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8', ate: '8',
  nine: '9',
  star: '*',
  pound: '#', hash: '#', number: '#',
};

function speechToDigit(speech: string): string | null {
  const word = speech.trim().toLowerCase();
  return SPOKEN_DIGITS[word] || null;
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}
