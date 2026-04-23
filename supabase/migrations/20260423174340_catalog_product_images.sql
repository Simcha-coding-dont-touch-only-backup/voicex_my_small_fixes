-- Add image storage to catalog_products
-- amazon_image_urls: full gallery from Rye/Amazon (hotlinked, lazy-loaded in lightbox)
-- thumbnail_path: path inside the product-images Supabase Storage bucket for the featured
-- thumbnail we download once at product create time so list pages render fast & reliably.
ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS amazon_image_urls JSONB,
  ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

-- Public bucket for product thumbnails. Public so admin pages can hotlink the public URL
-- without signed URLs. Files are owned by the service role.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Allow public read of objects in this bucket (matches `public = true` semantics).
DROP POLICY IF EXISTS "product-images public read" ON storage.objects;
CREATE POLICY "product-images public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');
