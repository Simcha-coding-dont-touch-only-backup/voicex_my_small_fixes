CREATE TABLE ivr_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_detail TEXT,
  caller_id TEXT,
  user_id UUID REFERENCES users(id),
  user_name TEXT,
  node_key TEXT,
  flow_version_id UUID,
  session_data JSONB,
  raw_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ivr_error_logs_created ON ivr_error_logs (created_at DESC);
CREATE INDEX idx_ivr_error_logs_type ON ivr_error_logs (error_type);
CREATE INDEX idx_ivr_error_logs_user ON ivr_error_logs (user_id) WHERE user_id IS NOT NULL;
