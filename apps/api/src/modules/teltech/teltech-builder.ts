import { config } from '../../config.js';
import type { IvrNode, IvrIntent } from '@voicex/shared';
import type { TeltechResponse, TeltechCollectAction, TeltechGatherAction } from '../../lib/teltech.js';

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
function sanitizeForTTS(text: string): string {
  const suffix = ttsCacheBustSuffix();
  const maxBody = Math.max(0, TELTECH_TTS_MAX_CHARS - suffix.length);

  const cleaned = text
    .replace(/(\d)[""\u201C\u201D]/g, '$1 inch')  // 12" → 12 inch
    .replace(/[""\u201C\u201D''\u2018\u2019]/g, '') // strip remaining quotes
    .replace(/&/g, ' and ')
    .replace(/[<>\\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!cleaned) return '';
  return (cleaned.slice(0, maxBody) + suffix).slice(0, TELTECH_TTS_MAX_CHARS);
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

  const gather: TeltechGatherAction = {
    action: 'gather',
    min_digits: options.numDigits || 1,
    max_digits: options.numDigits || 20,
    timeout: (options.timeout || 5) * 1000,
    digit_timeout: hasFixedDigits ? 500 : undefined,
    tries: options.tries ?? 3,
    prompt: options.promptAudioUrl
      ? { action: 'play', file: options.promptAudioUrl }
      : { action: 'say', text: sanitizeForTTS(options.prompt) },
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

  return { actions: [gather] };
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
    const text = sanitizeForTTS(message);
    if (text) {
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
  return {
    actions: [
      {
        action: 'say',
        text: sanitizeForTTS(
          'Phone-based payment is temporarily unavailable. Please use the web app to complete your purchase. Returning to the main menu.',
        ),
      },
      { action: 'redirect', url: `${BASE}/api/ivr/voice/gather?node_key=main_menu&${queryParams.toString()}` },
    ],
  };
}

export function buildHangup(message?: string, promptAudioUrl?: string): TeltechResponse {
  const actions: TeltechResponse['actions'] = [];
  if (promptAudioUrl) {
    actions.push({ action: 'play', file: promptAudioUrl });
  } else if (message) {
    actions.push({ action: 'say', text: sanitizeForTTS(message) });
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

  const collectAction: TeltechCollectAction = {
    action: 'collect' as const,
    type: options.type,
    id: options.id,
    prompt: { action: 'say', text: sanitizeForTTS(options.prompt) },
    confirm: options.confirm ?? true,
    retry: options.retry ?? 3,
    action_url: actionUrl,
    transcribe: options.transcribe,
    confirm_method: options.confirmMethod,
    max_duration: options.maxDuration,
  };

  return { actions: [collectAction] };
}

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
