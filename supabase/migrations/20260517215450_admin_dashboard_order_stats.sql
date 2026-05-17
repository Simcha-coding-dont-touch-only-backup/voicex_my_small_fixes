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
          'product_id', bs.product_id::text,
          'product_name', bs.product_name,
          'units_sold', bs.units_sold
        )
        ORDER BY bs.units_sold DESC
      )
      FROM (
        SELECT
          oi.product_id,
          MAX(oi.product_name) AS product_name,
          SUM(oi.quantity)::bigint AS units_sold
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'completed'
        GROUP BY oi.product_id
        ORDER BY units_sold DESC
        LIMIT 5
      ) bs
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION get_admin_dashboard_order_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_admin_dashboard_order_stats() TO service_role;
