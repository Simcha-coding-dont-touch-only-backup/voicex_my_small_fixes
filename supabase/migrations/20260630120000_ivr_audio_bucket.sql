-- Storage for IVR node prompt recordings (audio files uploaded in the IVR flow editor).
-- Public bucket so TelTech can fetch the recording over its public URL when playing it
-- to the caller (mirrors the existing `product-images` bucket pattern). Files are
-- written by the service role from the admin API; the public can only read.
INSERT INTO storage.buckets (id, name, public)
VALUES ('ivr-audio', 'ivr-audio', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Allow public read of objects in this bucket (matches `public = true` semantics).
DROP POLICY IF EXISTS "ivr-audio public read" ON storage.objects;
CREATE POLICY "ivr-audio public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ivr-audio');
