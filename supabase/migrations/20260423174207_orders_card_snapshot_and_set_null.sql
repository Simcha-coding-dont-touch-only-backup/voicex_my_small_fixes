-- Snapshot the card brand + last4 onto each order so historical orders
-- still display the card used even after the saved payment_method is
-- deleted. Then switch the FK to ON DELETE SET NULL so admins can
-- delete saved cards without being blocked by referencing orders.

ALTER TABLE orders
  ADD COLUMN card_brand_snapshot TEXT,
  ADD COLUMN card_last4_snapshot TEXT;

UPDATE orders o
SET
  card_brand_snapshot = pm.card_brand,
  card_last4_snapshot = pm.card_last4
FROM payment_methods pm
WHERE o.payment_method_id = pm.id
  AND o.card_last4_snapshot IS NULL;

ALTER TABLE orders
  DROP CONSTRAINT orders_payment_method_id_fkey;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_method_id_fkey
  FOREIGN KEY (payment_method_id)
  REFERENCES payment_methods(id)
  ON DELETE SET NULL;
