-- Track checkout/sync items whose live Rainforest price could NOT be verified
-- (timeout or API error) and which were therefore charged/recorded at the
-- cached catalog price. This keeps the IVR call from being dropped when
-- Rainforest is slow, while making such "stale pricing" checkouts auditable in
-- the Product Sync report.
ALTER TABLE public.product_sync_run_items
  ADD COLUMN IF NOT EXISTS stale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stale_reason text;

COMMENT ON COLUMN public.product_sync_run_items.stale IS 'True when the live Rainforest lookup could not be verified (timeout/error) and the cached catalog price was used instead. At checkout this means the customer was charged on unverified pricing.';
COMMENT ON COLUMN public.product_sync_run_items.stale_reason IS 'Why the item was treated as stale (e.g. Rainforest timeout/HTTP error).';
