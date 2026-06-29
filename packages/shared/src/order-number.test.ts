import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatOrderIdForSpeech } from './order-number.js';

describe('formatOrderIdForSpeech', () => {
  it('joins digits with comma-space for slower TTS pacing', () => {
    assert.equal(formatOrderIdForSpeech(10022), '1, 0, 0, 2, 2');
  });

  it('accepts string input', () => {
    assert.equal(formatOrderIdForSpeech('10022'), '1, 0, 0, 2, 2');
  });

  it('strips non-digits and leading zeros before formatting', () => {
    assert.equal(formatOrderIdForSpeech('#010022'), '1, 0, 0, 2, 2');
  });

  it('returns empty string for empty or non-digit input', () => {
    assert.equal(formatOrderIdForSpeech(''), '');
    assert.equal(formatOrderIdForSpeech('abc'), '');
  });

  it('formats each digit individually without grouping', () => {
    assert.equal(formatOrderIdForSpeech(123456), '1, 2, 3, 4, 5, 6');
  });
});
