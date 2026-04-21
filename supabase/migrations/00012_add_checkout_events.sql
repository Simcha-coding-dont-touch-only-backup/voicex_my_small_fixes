-- Per-call/per-order checkout event log.
--
-- Captures every step of the checkout flow (address selection, payment
-- method selection, Rye intent creation, stock-issue resolution, Sola
-- auth/capture, Rye drawdown confirm, order persistence) with structured
-- detail. Lives alongside ivr_error_logs (which captures every IVR
-- webhook) and order_events (which is keyed by order_id and only exists
-- after an order row is created).
--
-- Keyed by call_sid so events are queryable even when checkout fails
-- before an order row exists.

CREATE TABLE checkout_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  order_id UUID REFERENCES orders(id),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkout_events_call_sid ON checkout_events (call_sid);
CREATE INDEX idx_checkout_events_created ON checkout_events (created_at DESC);
CREATE INDEX idx_checkout_events_order ON checkout_events (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_checkout_events_user ON checkout_events (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_checkout_events_severity ON checkout_events (severity) WHERE severity != 'info';
