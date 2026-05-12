-- Atomic generation of voicex_id to remove the read-max-then-insert race in
-- the admin import endpoints. A sequence + helper function gives us a
-- single, transactional source of truth so concurrent inserts never
-- compute the same id.
--
-- The sequence is owned by the column so it is dropped automatically if the
-- column ever goes away. We start at MAX(voicex_id) + 1 (currently 2517 in
-- production), and the helper function loops past any pre-existing
-- voicex_id values (the PATCH /products/:id endpoint still allows admins to
-- set voicex_id manually, so the sequence could theoretically lag behind).

CREATE SEQUENCE IF NOT EXISTS public.catalog_products_voicex_seq
  START WITH 2518
  MINVALUE 1001
  OWNED BY public.catalog_products.voicex_id;

-- Make absolutely sure the sequence starts above whatever is currently in
-- the table, in case rows were added after this migration was authored.
SELECT setval(
  'public.catalog_products_voicex_seq',
  GREATEST(
    2517,
    COALESCE(
      (SELECT MAX(NULLIF(REGEXP_REPLACE(voicex_id, '\D', '', 'g'), '')::bigint)
         FROM public.catalog_products),
      1000
    )
  )
);

CREATE OR REPLACE FUNCTION public.next_voicex_id()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
  attempts int := 0;
BEGIN
  LOOP
    candidate := LPAD(nextval('public.catalog_products_voicex_seq')::text, 7, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.catalog_products WHERE voicex_id = candidate
    );
    attempts := attempts + 1;
    IF attempts > 10000 THEN
      RAISE EXCEPTION 'next_voicex_id: could not find a free id after % attempts', attempts;
    END IF;
  END LOOP;
  RETURN candidate;
END;
$$;

ALTER TABLE public.catalog_products
  ALTER COLUMN voicex_id SET DEFAULT public.next_voicex_id();
