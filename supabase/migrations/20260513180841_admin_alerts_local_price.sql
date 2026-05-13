-- Persisted admin alerts (extensible). First use: VoiceX effective price above local retail.

CREATE TABLE public.admin_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'resolved')),
  entity_type TEXT NOT NULL DEFAULT 'catalog_product',
  entity_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_admin_alerts_product_alert_type
  ON public.admin_alerts (product_id, alert_type);

CREATE INDEX idx_admin_alerts_status ON public.admin_alerts (status);

CREATE INDEX idx_admin_alerts_alert_type ON public.admin_alerts (alert_type);

CREATE INDEX idx_admin_alerts_created_at ON public.admin_alerts (created_at DESC);

ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_admin_alerts_updated_at ON public.admin_alerts;
CREATE TRIGGER trg_admin_alerts_updated_at
  BEFORE UPDATE ON public.admin_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill existing products where effective VoiceX price > local_price_cents
WITH markup AS (
  SELECT COALESCE(
    (SELECT NULLIF(TRIM(value), '')::numeric
     FROM public.settings
     WHERE key = 'default_markup_percent'
     LIMIT 1),
    15::numeric
  ) AS pct
),
effective AS (
  SELECT
    p.id AS product_id,
    p.voicex_id,
    p.amazon_asin,
    p.voice_name,
    p.amazon_name,
    p.custom_price_cents,
    p.amazon_price_cents,
    p.local_price_cents,
    m.pct AS default_markup_percent,
    CASE
      WHEN p.custom_price_cents IS NOT NULL THEN p.custom_price_cents::bigint
      WHEN p.amazon_price_cents IS NOT NULL
        THEN ROUND(p.amazon_price_cents::numeric * (1 + m.pct / 100))::bigint
      ELSE NULL
    END AS effective_custom_price_cents
  FROM public.catalog_products p
  CROSS JOIN markup m
  WHERE p.deleted_at IS NULL
)
INSERT INTO public.admin_alerts (
  alert_type,
  status,
  entity_type,
  entity_id,
  product_id,
  title,
  message,
  payload,
  resolved_at
)
SELECT
  'product_voicex_price_above_local',
  'new',
  'catalog_product',
  e.product_id,
  e.product_id,
  'VoiceX price above local retail',
  'Effective VoiceX price exceeds the configured local store price for this product.',
  jsonb_build_object(
    'voicex_id', e.voicex_id,
    'amazon_asin', e.amazon_asin,
    'voice_name', e.voice_name,
    'amazon_name', e.amazon_name,
    'effective_custom_price_cents', e.effective_custom_price_cents,
    'custom_price_cents', e.custom_price_cents,
    'amazon_price_cents', e.amazon_price_cents,
    'local_price_cents', e.local_price_cents,
    'default_markup_percent', e.default_markup_percent
  ),
  NULL
FROM effective e
WHERE e.local_price_cents IS NOT NULL
  AND e.effective_custom_price_cents IS NOT NULL
  AND e.effective_custom_price_cents > e.local_price_cents
ON CONFLICT (product_id, alert_type) DO NOTHING;
