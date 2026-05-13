BEGIN;

-- Drop FKs referencing orders(id)
ALTER TABLE order_fulfillment_etas DROP CONSTRAINT IF EXISTS order_fulfillment_etas_order_id_fkey;
ALTER TABLE checkout_events DROP CONSTRAINT IF EXISTS checkout_events_order_id_fkey;
ALTER TABLE order_holds DROP CONSTRAINT IF EXISTS order_holds_order_id_fkey;
ALTER TABLE order_events DROP CONSTRAINT IF EXISTS order_events_order_id_fkey;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_order_id_fkey;

-- Unique on etas uses order_id
ALTER TABLE order_fulfillment_etas DROP CONSTRAINT IF EXISTS order_fulfillment_etas_order_id_sort_order_key;

-- Map new bigint ids (100, 101, ...)
ALTER TABLE orders ADD COLUMN id_new BIGINT;

WITH numbered AS (
  SELECT id, (99 + ROW_NUMBER() OVER (ORDER BY created_at, id))::BIGINT AS new_id FROM orders
)
UPDATE orders o SET id_new = n.new_id FROM numbered n WHERE o.id = n.id;

-- Child tables: parallel bigint column
ALTER TABLE order_items ADD COLUMN order_id_new BIGINT;
UPDATE order_items oi SET order_id_new = o.id_new FROM orders o WHERE oi.order_id = o.id;
ALTER TABLE order_items DROP COLUMN order_id;
ALTER TABLE order_items RENAME COLUMN order_id_new TO order_id;
ALTER TABLE order_items ALTER COLUMN order_id SET NOT NULL;

ALTER TABLE order_events ADD COLUMN order_id_new BIGINT;
UPDATE order_events oe SET order_id_new = o.id_new FROM orders o WHERE oe.order_id = o.id;
ALTER TABLE order_events DROP COLUMN order_id;
ALTER TABLE order_events RENAME COLUMN order_id_new TO order_id;
ALTER TABLE order_events ALTER COLUMN order_id SET NOT NULL;

ALTER TABLE order_holds ADD COLUMN order_id_new BIGINT;
UPDATE order_holds oh SET order_id_new = o.id_new FROM orders o WHERE oh.order_id = o.id;
ALTER TABLE order_holds DROP COLUMN order_id;
ALTER TABLE order_holds RENAME COLUMN order_id_new TO order_id;
ALTER TABLE order_holds ALTER COLUMN order_id SET NOT NULL;

ALTER TABLE order_fulfillment_etas ADD COLUMN order_id_new BIGINT;
UPDATE order_fulfillment_etas e SET order_id_new = o.id_new FROM orders o WHERE e.order_id = o.id;
ALTER TABLE order_fulfillment_etas DROP COLUMN order_id;
ALTER TABLE order_fulfillment_etas RENAME COLUMN order_id_new TO order_id;
ALTER TABLE order_fulfillment_etas ALTER COLUMN order_id SET NOT NULL;

ALTER TABLE checkout_events ADD COLUMN order_id_new BIGINT;
UPDATE checkout_events ce SET order_id_new = o.id_new FROM orders o WHERE ce.order_id = o.id;
ALTER TABLE checkout_events DROP COLUMN order_id;
ALTER TABLE checkout_events RENAME COLUMN order_id_new TO order_id;

-- Replace orders PK
ALTER TABLE orders DROP CONSTRAINT orders_pkey;
ALTER TABLE orders DROP COLUMN id;
ALTER TABLE orders RENAME COLUMN id_new TO id;
ALTER TABLE orders ALTER COLUMN id SET NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE order_fulfillment_etas ADD CONSTRAINT order_fulfillment_etas_order_id_sort_order_key UNIQUE (order_id, sort_order);

-- Re-create FKs
ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE order_events ADD CONSTRAINT order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE order_holds ADD CONSTRAINT order_holds_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
ALTER TABLE checkout_events ADD CONSTRAINT checkout_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
ALTER TABLE order_fulfillment_etas ADD CONSTRAINT order_fulfillment_etas_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

-- Sequence for new orders (starts after current max)
DROP SEQUENCE IF EXISTS orders_id_seq CASCADE;
CREATE SEQUENCE orders_id_seq AS BIGINT INCREMENT BY 1 MINVALUE 100 MAXVALUE 9223372036854775807;
ALTER SEQUENCE orders_id_seq OWNED BY orders.id;
SELECT setval('orders_id_seq', GREATEST(99, (SELECT COALESCE(MAX(id), 0) FROM orders)));
ALTER TABLE orders ALTER COLUMN id SET DEFAULT nextval('orders_id_seq');

COMMIT;
