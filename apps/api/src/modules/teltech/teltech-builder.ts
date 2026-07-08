import { config } from '../../config.js';
import type { IvrNode, IvrIntent } from '@voicex/shared';
import type { TeltechResponse, TeltechCollectAction, TeltechGatherAction, TeltechSayAction } from '../../lib/teltech.js';

const BASE = config.apiBaseUrl;
const TELTECH_TTS_MAX_CHARS = 500;
/** Zero-width space — changes Teltech's TTS cache key without audible output. */
const TTS_CACHE_BUST_MARKER = '\u200B';
const TTS_CACHE_BUST_MAX_MARKERS = 50;

function ttsCacheBustSuffix(): string {
  const version = config.teltech.ttsCacheVersion;
  if (!version) return '';

  const parsed = parseInt(version, 10);
  const count = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : version.length;
  const repeats = Math.min(Math.max(count, 1), TTS_CACHE_BUST_MAX_MARKERS);

  // Repeat invisible markers only — digits after ZWSP were read aloud as "two", etc.
  return TTS_CACHE_BUST_MARKER.repeat(repeats);
}

/**
 * Resolve the gather timeout (in seconds) for a node. The node's editor-set
 * `config.timeout_seconds` always wins when present so changes made in the IVR
 * flow editor actually take effect; otherwise we fall back to the caller's
 * per-prompt default (e.g. a longer window for card entry, a shorter one for a
 * re-prompt). Pass `undefined`/`null` for `node` when there is no node context
 * and only the fallback should apply.
 */
export function resolveNodeTimeout(
  node: { config?: { timeout_seconds?: number } } | null | undefined,
  fallbackSeconds: number,
): number {
  const configured = node?.config?.timeout_seconds;
  return typeof configured === 'number' && configured > 0 ? configured : fallbackSeconds;
}

/**
 * Sanitize text for TelTech TTS (FreeSWITCH say action).
 * Strips characters that can break or silence TTS output:
 * - Double quotes / smart quotes (e.g. 12" Melamine)
 * - Ampersands, angle brackets, backslashes
 * - Truncates to 500 chars (TelTech hard limit)
 * - Optionally appends an invisible cache-bust suffix (TELTECH_TTS_CACHE_VERSION)
 */
function cleanForTTS(text: string): string {
  return text
    .replace(/(\d)[""\u201C\u201D]/g, '$1 inch')  // 12" → 12 inch
    .replace(/[""\u201C\u201D''\u2018\u2019]/g, '') // strip remaining quotes
    .replace(/&/g, ' and ')
    .replace(/[<>\\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeForTTS(text: string): string {
  const suffix = ttsCacheBustSuffix();
  const maxBody = Math.max(0, TELTECH_TTS_MAX_CHARS - suffix.length);
  const cleaned = cleanForTTS(text);
  if (!cleaned) return '';
  return (cleaned.slice(0, maxBody) + suffix).slice(0, TELTECH_TTS_MAX_CHARS);
}

/**
 * Split long text into multiple TTS-safe chunks (each ≤ 500 chars).
 * Splits at sentence boundaries (`. `) when possible, falling back to
 * word boundaries, so speech sounds natural across chunks.
 */
function splitForTTS(text: string): string[] {
  const suffix = ttsCacheBustSuffix();
  const maxBody = Math.max(0, TELTECH_TTS_MAX_CHARS - suffix.length);
  const cleaned = cleanForTTS(text);
  if (!cleaned) return [];

  // Fits in one chunk — no splitting needed.
  if (cleaned.length <= maxBody) {
    return [(cleaned + suffix).slice(0, TELTECH_TTS_MAX_CHARS)];
  }

  // Split at sentence boundaries first.
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxBody && current) {
      chunks.push((current + suffix).slice(0, TELTECH_TTS_MAX_CHARS));
      current = sentence;
    } else {
      current = candidate;
    }
  }

  // Flush remaining text, hard-splitting at word boundaries if still too long.
  while (current.length > maxBody) {
    const splitIdx = current.lastIndexOf(' ', maxBody);
    const idx = splitIdx > 0 ? splitIdx : maxBody;
    chunks.push((current.slice(0, idx) + suffix).slice(0, TELTECH_TTS_MAX_CHARS));
    current = current.slice(idx).trim();
  }
  if (current) {
    chunks.push((current + suffix).slice(0, TELTECH_TTS_MAX_CHARS));
  }

  return chunks;
}

export function buildGather(options: {
  prompt: string;
  actionPath: string;
  numDigits?: number;
  timeout?: number;
  finishOnKey?: string;
  retryPrompt?: string;
  tries?: number;
  sessionData?: Record<string, string>;
  regex?: string;
  ignoreBareTerminator?: boolean;
  /** When set, TelTech plays this audio URL as the prompt instead of speaking `prompt`. */
  promptAudioUrl?: string;
}): TeltechResponse {
  const queryParams = new URLSearchParams(options.sessionData || {});
  const actionUrl = `${BASE}${options.actionPath}?${queryParams.toString()}`;

  const hasExplicitTerminator = options.finishOnKey !== undefined && options.finishOnKey !== '';
  const hasFixedDigits = options.numDigits !== undefined && options.numDigits > 0;

  // `*` must be a *collectable digit*, NOT a terminator. When `*` is configured
  // as a terminator and the caller presses it on an empty buffer, Teltech has
  // nothing to submit, so it silently re-prompts the same gather and never
  // POSTs to action_url — which means the universal back handler in
  // gather-result.ts never runs (the caller just hears the current menu again).
  // By keeping the terminator to the caller's explicit finishOnKey only (or
  // none) and allowing `*` through the regex, a lone `*` satisfies min_digits
  // and is delivered as digits:"*", letting the back handler pop the stack.
  const terminator = hasExplicitTerminator ? options.finishOnKey : undefined;

  // Split long prompts into multiple say actions so nothing is truncated.
  // All chunks except the last play as standalone say actions before the
  // gather; the final chunk becomes the gather's own prompt (the part the
  // caller hears while the system waits for keypad input).
  const chunks = options.promptAudioUrl ? [] : splitForTTS(options.prompt);
  const prefixSays: TeltechSayAction[] = chunks.length > 1
    ? chunks.slice(0, -1).map((text) => ({ action: 'say' as const, text }))
    : [];

  const gather: TeltechGatherAction = {
    action: 'gather',
    min_digits: options.numDigits || 1,
    max_digits: options.numDigits || 20,
    timeout: (options.timeout || 5) * 1000,
    digit_timeout: hasFixedDigits ? 500 : undefined,
    tries: options.tries ?? 3,
    prompt: options.promptAudioUrl
      ? { action: 'play', file: options.promptAudioUrl }
      : { action: 'say', text: chunks[chunks.length - 1] || sanitizeForTTS(options.prompt) },
    action_url: actionUrl,
    terminator,
    regex: options.regex ?? '[0-9*#]+',
    ignore_bare_terminator: options.ignoreBareTerminator ?? undefined,
    // `*` fires "back" immediately on Teltech's side, even mid-entry on
    // multi-digit gathers (PIN, catalog ID, card number, etc.), so callers no
    // longer need to press `*#`. The server-side back handler in
    // gather-result.ts still treats incoming `*` as a back request.
    back_key: '*',
  };

  return { actions: [...prefixSays, gather] };
}

export function buildSay(
  message: string,
  redirectPath?: string,
  sessionData?: Record<string, string>,
  promptAudioUrl?: string,
): TeltechResponse {
  const actions: TeltechResponse['actions'] = [];
  if (promptAudioUrl) {
    actions.push({ action: 'play', file: promptAudioUrl });
  } else {
    const chunks = splitForTTS(message);
    for (const text of chunks) {
      actions.push({ action: 'say', text });
    }
  }
  if (redirectPath) {
    let url = `${BASE}${redirectPath}`;
    if (sessionData) {
      const queryParams = new URLSearchParams(sessionData);
      const separator = redirectPath.includes('?') ? '&' : '?';
      url += `${separator}${queryParams.toString()}`;
    }
    actions.push({ action: 'redirect', url });
  }
  return { actions };
}

export function buildPayGather(_options: {
  chargeAmount: number;
  currency?: string;
  description?: string;
  sessionData?: Record<string, string>;
}): TeltechResponse {
  const queryParams = new URLSearchParams(_options.sessionData || {});
  const chunks = splitForTTS(
    'Phone-based payment is temporarily unavailable. Please use the web app to complete your purchase. Returning to the main menu.',
  );
  return {
    actions: [
      ...chunks.map((text) => ({ action: 'say' as const, text })),
      { action: 'redirect', url: `${BASE}/api/ivr/voice/gather?node_key=main_menu&${queryParams.toString()}` },
    ],
  };
}

export function buildHangup(message?: string, promptAudioUrl?: string): TeltechResponse {
  const actions: TeltechResponse['actions'] = [];
  if (promptAudioUrl) {
    actions.push({ action: 'play', file: promptAudioUrl });
  } else if (message) {
    const chunks = splitForTTS(message);
    for (const text of chunks) {
      actions.push({ action: 'say', text });
    }
  }
  actions.push({ action: 'hangup' });
  return { actions };
}

export function buildGatherFromNode(
  node: IvrNode,
  sessionData: Record<string, string>,
  overrides?: { prompt?: string; timeout?: number }
): TeltechResponse {
  // Only use the node's recording when we're speaking the node's own prompt.
  // Dynamic overrides (e.g. a prompt with a live price) can't be pre-recorded.
  const promptAudioUrl = overrides?.prompt ? undefined : node.config.prompt_audio_url;

  return buildGather({
    prompt: overrides?.prompt || node.prompt_text || 'Please make a selection.',
    actionPath: '/api/ivr/voice/gather',
    numDigits: node.config.num_digits,
    timeout: overrides?.timeout || node.config.timeout_seconds || 5,
    finishOnKey: node.config.finish_on_key,
    ignoreBareTerminator: node.config.ignore_bare_terminator,
    promptAudioUrl,
    sessionData: {
      ...sessionData,
      node_key: node.node_key,
    },
  });
}

export function buildMenuFromNode(
  node: IvrNode,
  sessionData: Record<string, string>
): TeltechResponse {
  return buildGatherFromNode(node, sessionData);
}

export function buildCollect(options: {
  type: 'recording' | 'voice' | 'phone' | 'email' | 'date' | 'number' | 'amount' | 'text' | 'choice' | 'yes_no' | 'id_number' | 'time' | 'credit_card';
  id: string;
  prompt: string;
  confirm?: boolean;
  confirmMethod?: 'playback' | 'transcribe' | 'both';
  transcribe?: boolean;
  retry?: number;
  maxDuration?: number;
  actionPath: string;
  sessionData?: Record<string, string>;
}): TeltechResponse {
  const queryParams = new URLSearchParams(options.sessionData || {});
  const actionUrl = `${BASE}${options.actionPath}?${queryParams.toString()}`;

  const chunks = splitForTTS(options.prompt);
  const prefixSays: TeltechSayAction[] = chunks.length > 1
    ? chunks.slice(0, -1).map((text) => ({ action: 'say' as const, text }))
    : [];

  const collectAction: TeltechCollectAction = {
    action: 'collect' as const,
    type: options.type,
    id: options.id,
    prompt: { action: 'say', text: chunks[chunks.length - 1] || sanitizeForTTS(options.prompt) },
    confirm: options.confirm ?? true,
    retry: options.retry ?? 3,
    action_url: actionUrl,
    transcribe: options.transcribe,
    confirm_method: options.confirmMethod,
    max_duration: options.maxDuration,
  };

  return { actions: [...prefixSays, collectAction] };
}

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
