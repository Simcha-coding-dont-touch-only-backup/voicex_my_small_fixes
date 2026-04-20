-- Pad all voicex_id values to a uniform 7-digit zero-prefixed format.
-- Strips any pre-existing leading zeros first to handle previously-padded
-- 6-digit values, then re-pads to width 7. Numeric ordering is preserved
-- because every value ends up the same length.

UPDATE catalog_products
SET voicex_id = LPAD(REGEXP_REPLACE(voicex_id, '^0+', ''), 7, '0')
WHERE length(voicex_id) <> 7
   OR voicex_id !~ '^0+\d+$';

UPDATE cart_items
SET voicex_id = LPAD(REGEXP_REPLACE(voicex_id, '^0+', ''), 7, '0')
WHERE length(voicex_id) <> 7
   OR voicex_id !~ '^0+\d+$';

UPDATE order_items
SET voicex_id = LPAD(REGEXP_REPLACE(voicex_id, '^0+', ''), 7, '0')
WHERE length(voicex_id) <> 7
   OR voicex_id !~ '^0+\d+$';
