import { config } from '../config.js';

export const TELTECH_BASE = config.apiBaseUrl;

export interface TeltechSayAction {
  action: 'say';
  text: string;
  language?: string;
}

export interface TeltechPlayAction {
  action: 'play';
  file: string;
}

export interface TeltechGatherAction {
  action: 'gather';
  min_digits?: number;
  max_digits?: number;
  timeout?: number;
  terminator?: string;
  tries?: number;
  regex?: string;
  digit_timeout?: number;
  prompt?: TeltechSayAction | TeltechPlayAction;
  action_url?: string;
  ignore_bare_terminator?: boolean;
  back_key?: string;
}

export interface TeltechRecordAction {
  action: 'record';
  max_duration?: number;
  silence_threshold?: number;
  silence_hits?: number;
  beep?: boolean;
  action_url?: string;
}

export interface TeltechCollectAction {
  action: 'collect';
  type: 'number' | 'phone' | 'date' | 'time' | 'amount' | 'email' | 'text' | 'recording' | 'voice' | 'choice' | 'yes_no' | 'id_number' | 'credit_card';
  id?: string;
  prompt?: TeltechSayAction | TeltechPlayAction | string;
  prompt_audio?: string;
  confirm?: boolean;
  confirm_method?: 'playback' | 'transcribe' | 'both';
  transcribe?: boolean;
  retry?: number;
  required?: boolean;
  reuse?: string;
  auto?: 'caller_id' | 'called_number' | 'timestamp' | 'uuid';
  on_value?: Record<string, string>;
  action_url?: string;
  empty_allowed?: boolean;
  empty_value?: string;
  allowed_chars?: string;
  char_replace?: Record<string, string>;
  min_digits?: number;
  max_digits?: number;
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  options?: Array<{ key: string; label: string; value: string }>;
  format?: string;
  default_source?: string;
  max_duration?: number;
  billing_sum?: number;
  regex?: string;
}

export interface TeltechDialAction {
  action: 'dial';
  number?: string;
  numbers?: string[];
  simultaneous?: boolean;
  caller_id?: string;
  timeout?: number;
  record?: boolean;
  accept_key?: string;
  accept_message?: string;
  reject_goto?: string;
  ring_music?: string;
  answer_message?: string;
  action_url?: string;
}

export interface TeltechRedirectAction {
  action: 'redirect';
  url: string;
}

export interface TeltechSetVariableAction {
  action: 'set_variable';
  key: string;
  value: string;
}

export interface TeltechPauseAction {
  action: 'pause';
  duration?: number;
}

export interface TeltechGotoAction {
  action: 'goto';
  path: string;
}

export interface TeltechHangupAction {
  action: 'hangup';
  reason?: string;
}

export interface TeltechSendDigitsAction {
  action: 'send_digits';
  digits: string;
  duration?: number;
}

export interface TeltechStreamAction {
  action: 'stream';
  url: string;
  exit_key?: string;
}

export interface TeltechMessagePart {
  type: 'file' | 'text' | 'number' | 'digits' | 'letters' | 'amount' | 'date' | 'time' | 'variable' | 'silence';
  value?: string;
  key?: string;
  format?: string;
}

export interface TeltechMessageAction {
  action: 'message';
  parts: TeltechMessagePart[];
}

export type TeltechAction =
  | TeltechSayAction
  | TeltechPlayAction
  | TeltechGatherAction
  | TeltechRecordAction
  | TeltechCollectAction
  | TeltechDialAction
  | TeltechRedirectAction
  | TeltechSetVariableAction
  | TeltechPauseAction
  | TeltechGotoAction
  | TeltechHangupAction
  | TeltechSendDigitsAction
  | TeltechStreamAction
  | TeltechMessageAction;

export interface TeltechResponse {
  actions: TeltechAction[];
}

export interface TeltechWebhookPayload {
  event: 'new_call' | 'gather' | 'record' | 'collect' | 'dial' | 'redirect' | 'hangup';
  call_id: string;
  caller_id: string;
  did: string;
  extension: string;
  timestamp: number;
  variables: Record<string, string>;
  digits?: string;
  recording_path?: string;
  field_id?: string;
  field_value?: string;
  field_type?: string;
  field_transcript?: string;
  dial_result?: string;
  dial_duration?: number;
  dial_number?: string;
  collected?: Record<string, string>;
}
