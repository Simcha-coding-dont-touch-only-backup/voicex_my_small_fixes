import { config } from '../../config.js';
import type { IvrNode, IvrIntent } from '@voicex/shared';
import type { TeltechResponse, TeltechCollectAction, TeltechGatherAction } from '../../lib/teltech.js';

const BASE = config.apiBaseUrl;

/**
 * Sanitize text for TelTech TTS (FreeSWITCH say action).
 * Strips characters that can break or silence TTS output:
 * - Double quotes / smart quotes (e.g. 12" Melamine)
 * - Ampersands, angle brackets, backslashes
 * - Truncates to 500 chars (TelTech hard limit)
 */
function sanitizeForTTS(text: string): string {
  return text
    .replace(/(\d)[""\u201C\u201D]/g, '$1 inch')  // 12" → 12 inch
    .replace(/[""\u201C\u201D''\u2018\u2019]/g, '') // strip remaining quotes
    .replace(/&/g, ' and ')
    .replace(/[<>\\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 500);
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
}): TeltechResponse {
  const queryParams = new URLSearchParams(options.sessionData || {});
  const actionUrl = `${BASE}${options.actionPath}?${queryParams.toString()}`;

  const hasExplicitTerminator = options.finishOnKey !== undefined && options.finishOnKey !== '';
  const hasFixedDigits = options.numDigits !== undefined && options.numDigits > 0;

  // `*` is always an additional terminator so the caller can press it at any
  // time to bail out of the current entry. The universal back handler in
  // gather-result.ts then pops the menu stack and re-dispatches the previous
  // node. Order matters: the caller's explicit finishOnKey (if any) comes
  // first so it remains the "primary" terminator semantically. We preserve
  // the original "no terminator specified" intent (undefined) by appending
  // `*` to an empty base rather than substituting `#`.
  const baseTerminator = hasExplicitTerminator
    ? options.finishOnKey
    : (hasFixedDigits ? '' : undefined);
  const terminator = baseTerminator?.includes('*')
    ? baseTerminator
    : `${baseTerminator ?? ''}*`;

  const gather: TeltechGatherAction = {
    action: 'gather',
    min_digits: options.numDigits || 1,
    max_digits: options.numDigits || 20,
    timeout: (options.timeout || 5) * 1000,
    digit_timeout: hasFixedDigits ? 500 : undefined,
    tries: options.tries ?? 3,
    prompt: { action: 'say', text: sanitizeForTTS(options.prompt) },
    action_url: actionUrl,
    terminator,
    regex: '[0-9*#]+',
  };

  return { actions: [gather] };
}

export function buildSay(message: string, redirectPath?: string, sessionData?: Record<string, string>): TeltechResponse {
  const actions: TeltechResponse['actions'] = [
    { action: 'say', text: sanitizeForTTS(message) },
  ];
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
      { action: 'say', text: 'Phone-based payment is temporarily unavailable. Please use the web app to complete your purchase. Returning to the main menu.' },
      { action: 'redirect', url: `${BASE}/api/ivr/voice/gather?node_key=main_menu&${queryParams.toString()}` },
    ],
  };
}

export function buildHangup(message?: string): TeltechResponse {
  const actions: TeltechResponse['actions'] = [];
  if (message) {
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
  return buildGather({
    prompt: overrides?.prompt || node.prompt_text || 'Please make a selection.',
    actionPath: '/api/ivr/voice/gather',
    numDigits: node.config.num_digits,
    timeout: overrides?.timeout || node.config.timeout_seconds || 5,
    finishOnKey: node.config.finish_on_key,
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
