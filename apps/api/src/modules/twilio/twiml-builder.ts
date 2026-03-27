import { TwiML } from '../../lib/twilio.js';
import { config } from '../../config.js';
import type { IvrNode, IvrIntent } from '@voicex/shared';

const BASE = config.apiBaseUrl;

export function buildGather(options: {
  prompt: string;
  actionPath: string;
  inputType?: 'dtmf' | 'speech' | 'dtmf speech';
  numDigits?: number;
  timeout?: number;
  finishOnKey?: string;
  hints?: string[];
  speechModel?: string;
  retryPrompt?: string;
  sessionData?: Record<string, string>;
}): string {
  const response = new TwiML.VoiceResponse();

  const queryParams = new URLSearchParams(options.sessionData || {});
  const actionUrl = `${BASE}${options.actionPath}?${queryParams.toString()}`;

  const gather = response.gather({
    input: (options.inputType as any) || 'dtmf speech',
    action: actionUrl,
    method: 'POST',
    timeout: options.timeout || 5,
    numDigits: options.numDigits,
    finishOnKey: options.finishOnKey,
    hints: options.hints?.join(', '),
    speechModel: options.speechModel || 'experimental_utterances',
    language: 'en-US',
  });

  gather.say({ voice: 'Polly.Matthew' }, options.prompt);

  if (options.retryPrompt) {
    response.say({ voice: 'Polly.Matthew' }, options.retryPrompt);
    response.redirect(`${BASE}${options.actionPath}?${queryParams.toString()}`);
  }

  return response.toString();
}

export function buildSay(message: string, redirectPath?: string): string {
  const response = new TwiML.VoiceResponse();
  response.say({ voice: 'Polly.Matthew' }, message);
  if (redirectPath) {
    response.redirect(`${BASE}${redirectPath}`);
  }
  return response.toString();
}

export function buildPayGather(options: {
  chargeAmount: number;
  currency?: string;
  description?: string;
  sessionData?: Record<string, string>;
}): string {
  const response = new TwiML.VoiceResponse();
  const queryParams = new URLSearchParams(options.sessionData || {});

  const pay = (response as any).pay({
    chargeAmount: options.chargeAmount.toString(),
    currency: options.currency || 'usd',
    description: options.description || 'VoiceX Order',
    paymentConnector: config.twilio.payConnector,
    action: `${BASE}/api/twilio/voice/payment?${queryParams.toString()}`,
    method: 'POST',
    tokenType: 'reusable',
    postalCode: false,
  });

  return response.toString();
}

export function buildHangup(message?: string): string {
  const response = new TwiML.VoiceResponse();
  if (message) {
    response.say({ voice: 'Polly.Matthew' }, message);
  }
  response.hangup();
  return response.toString();
}

export function buildMenuFromNode(
  node: IvrNode,
  sessionData: Record<string, string>
): string {
  const intents = node.config.intents || [];
  const hints = intents.flatMap((i: IvrIntent) => i.speech_phrases);
  const prompt = node.prompt_text || 'Please make a selection.';

  return buildGather({
    prompt,
    actionPath: '/api/twilio/voice/gather',
    inputType: (node.config.input_type as any) || 'dtmf speech',
    numDigits: node.config.num_digits,
    timeout: node.config.timeout_seconds || 5,
    finishOnKey: node.config.finish_on_key,
    hints,
    speechModel: node.config.speech_model,
    sessionData: {
      ...sessionData,
      node_key: node.node_key,
    },
  });
}

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
