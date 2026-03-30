import { config } from '../../config.js';
import type { IvrNode, IvrIntent } from '@voicex/shared';
import type { TeltechResponse } from '../../lib/teltech.js';

const BASE = config.apiBaseUrl;

export function buildGather(options: {
  prompt: string;
  actionPath: string;
  numDigits?: number;
  timeout?: number;
  finishOnKey?: string;
  retryPrompt?: string;
  sessionData?: Record<string, string>;
}): TeltechResponse {
  const queryParams = new URLSearchParams(options.sessionData || {});
  const actionUrl = `${BASE}${options.actionPath}?${queryParams.toString()}`;

  const actions: TeltechResponse['actions'] = [];

  actions.push({
    action: 'gather',
    min_digits: options.numDigits || 1,
    max_digits: options.numDigits || 20,
    timeout: (options.timeout || 5) * 1000,
    terminator: options.finishOnKey ?? '#',
    prompt: { action: 'say', text: options.prompt },
    action_url: actionUrl,
  });

  if (options.retryPrompt) {
    actions.push({ action: 'say', text: options.retryPrompt });
  }

  return { actions };
}

export function buildSay(message: string, redirectPath?: string): TeltechResponse {
  const actions: TeltechResponse['actions'] = [
    { action: 'say', text: message },
  ];
  if (redirectPath) {
    actions.push({ action: 'redirect', url: `${BASE}${redirectPath}` });
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
    actions.push({ action: 'say', text: message });
  }
  actions.push({ action: 'hangup' });
  return { actions };
}

export function buildMenuFromNode(
  node: IvrNode,
  sessionData: Record<string, string>
): TeltechResponse {
  const prompt = node.prompt_text || 'Please make a selection.';

  return buildGather({
    prompt,
    actionPath: '/api/ivr/voice/gather',
    numDigits: node.config.num_digits,
    timeout: node.config.timeout_seconds || 5,
    finishOnKey: node.config.finish_on_key,
    sessionData: {
      ...sessionData,
      node_key: node.node_key,
    },
  });
}

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
