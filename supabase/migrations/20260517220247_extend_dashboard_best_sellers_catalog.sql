CREATE OR REPLACE FUNCTION get_admin_dashboard_order_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'sales_total_cents', COALESCE((SELECT SUM(o.total_cents)::bigint FROM orders o WHERE o.status = 'completed'), 0),
    'profit_total_cents', COALESCE((
      SELECT SUM((oi.unit_price_cents - oi.amazon_price_cents) * oi.quantity)::bigint
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'completed'
    ), 0),
    'best_sellers', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', t.product_id::text,
          'product_name', t.product_name,
          'voicex_id', t.voicex_id,
          'units_sold', t.units_sold,
          'thumbnail_path', t.thumbnail_path,
          'amazon_image_urls', COALESCE(t.amazon_image_urls, '[]'::jsonb),
          'amazon_price_cents', t.amazon_price_cents,
          'custom_price_cents', t.custom_price_cents,
          'local_price_cents', t.local_price_cents
        )
        ORDER BY t.units_sold DESC
      )
      FROM (
        SELECT
          bs.product_id,
          bs.product_name,
          bs.units_sold,
          p.voicex_id,
          p.thumbnail_path,
          p.amazon_image_urls,
          p.amazon_price_cents,
          p.custom_price_cents,
          p.local_price_cents
        FROM (
          SELECT
            oi.product_id,
            MAX(oi.product_name) AS product_name,
            SUM(oi.quantity)::bigint AS units_sold
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          WHERE o.status = 'completed'
          GROUP BY oi.product_id
          ORDER BY SUM(oi.quantity) DESC
          LIMIT 5
        ) bs
        LEFT JOIN catalog_products p ON p.id = bs.product_id
      ) t
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION get_admin_dashboard_order_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_admin_dashboard_order_stats() TO service_role;
