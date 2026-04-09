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
  confirm?: boolean;
  confirm_method?: 'playback' | 'transcribe' | 'both';
  transcribe?: boolean;
  retry?: number;
  required?: boolean;
  max_duration?: number;
  action_url?: string;
}

export interface TeltechDialAction {
  action: 'dial';
  number: string;
  caller_id?: string;
  timeout?: number;
  time_limit?: number;
  record?: boolean;
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
}

export interface TeltechSendDigitsAction {
  action: 'send_digits';
  digits: string;
}

export interface TeltechStreamAction {
  action: 'stream';
  url: string;
}

export interface TeltechMessageAction {
  action: 'message';
  parts: Array<TeltechSayAction | TeltechPlayAction>;
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
