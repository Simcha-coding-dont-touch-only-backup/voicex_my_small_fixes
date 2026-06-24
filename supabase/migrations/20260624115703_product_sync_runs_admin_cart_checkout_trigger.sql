ALTER TABLE public.product_sync_runs DROP CONSTRAINT IF EXISTS product_sync_runs_trigger_check;
ALTER TABLE public.product_sync_runs ADD CONSTRAINT product_sync_runs_trigger_check CHECK (trigger IN ('auto', 'manual_full', 'manual_single', 'manual_bulk', 'checkout', 'admin_cart_checkout'));
