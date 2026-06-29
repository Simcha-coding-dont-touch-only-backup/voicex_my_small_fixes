export interface IvrFlow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IvrFlowVersion {
  id: string;
  flow_id: string;
  version_number: number;
  status: 'draft' | 'published' | 'archived';
  published_at: string | null;
  created_at: string;
}

export interface IvrNode {
  id: string;
  flow_version_id: string;
  node_key: string;
  node_type: IvrNodeType;
  handler_name: string | null;
  prompt_text: string | null;
  prompt_ssml: string | null;
  config: IvrNodeConfig;
  position_x: number;
  position_y: number;
  created_at: string;
}

export type IvrNodeType =
  | 'entry'
  | 'menu'
  | 'input'
  | 'action'
  | 'branch'
  | 'transfer'
  | 'hangup'
  | 'submenu';

export interface IvrNodeConfig {
  input_type?: 'dtmf' | 'speech' | 'dtmf_speech';
  num_digits?: number;
  timeout_seconds?: number;
  max_retries?: number;
  finish_on_key?: string;
  ignore_bare_terminator?: boolean;
  speech_hints?: string[];
  speech_model?: string;
  intents?: IvrIntent[];
}

export interface IvrIntent {
  name: string;
  dtmf_key?: string;
  speech_phrases: string[];
  target_node_key: string;
}

export interface IvrEdge {
  id: string;
  flow_version_id: string;
  source_node_id: string;
  target_node_id: string;
  condition_type: 'intent' | 'default' | 'timeout' | 'error' | 'match';
  condition_value: string | null;
  priority: number;
  created_at: string;
}

export interface IvrPromptVariant {
  id: string;
  node_id: string;
  variant_key: string;
  text: string;
  ssml: string | null;
  language: string;
  created_at: string;
}

export interface CallSession {
  id: string;
  call_sid: string;
  user_id: string | null;
  phone_number: string;
  flow_version_id: string;
  current_node_key: string;
  state_data: Record<string, unknown>;
  retry_count: number;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
}
