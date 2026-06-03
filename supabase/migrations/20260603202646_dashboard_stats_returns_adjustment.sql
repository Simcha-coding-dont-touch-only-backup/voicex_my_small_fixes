-- Adjust dashboard sales/profit for completed returns.
--
-- Only returns with status 'complete' affect financials (pending/processing
-- reserve quantity but have not refunded yet; cancelled/rejected/deleted are
-- voided). Adjustments honor admin-edited refund/fee fields:
--   * Sales lose the returned item subtotal plus the refunded tax (shipping is
--     never refunded, so it stays in sales).
--   * Profit changes by (amazon_refund - item_subtotal - fees): the customer
--     refund is a cost, the Amazon refund is recovered cost, and admin fees are
--     additional costs. A fully recovered, fee-free return nets zero profit.

CREATE OR REPLACE FUNCTION get_admin_dashboard_order_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH completed_returns AS (
    SELECT
      r.id,
      r.item_subtotal_cents,
      r.tax_refund_cents,
      r.amazon_refund_cents,
      COALESCE((
        SELECT SUM(f.amount_cents)
        FROM order_return_fees f
        WHERE f.return_id = r.id
      ), 0) AS fees_cents
    FROM order_returns r
    WHERE r.status = 'complete'
  )
  SELECT jsonb_build_object(
    'sales_total_cents', GREATEST(
      COALESCE((SELECT SUM(o.total_cents)::bigint FROM orders o WHERE o.status = 'completed'), 0)
        - COALESCE((SELECT SUM(cr.item_subtotal_cents + cr.tax_refund_cents)::bigint FROM completed_returns cr), 0),
      0
    ),
    'profit_total_cents', (
      COALESCE((
        SELECT SUM((oi.unit_price_cents - oi.amazon_price_cents) * oi.quantity)::bigint
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'completed'
      ), 0)
      + COALESCE((
        SELECT SUM(cr.amazon_refund_cents - cr.item_subtotal_cents - cr.fees_cents)::bigint
        FROM completed_returns cr
      ), 0)
    ),
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
            (SUM(oi.quantity) - COALESCE((
              SELECT SUM(ri.quantity)
              FROM order_return_items ri
              INNER JOIN order_returns r ON r.id = ri.return_id
              WHERE ri.product_id = oi.product_id AND r.status = 'complete'
            ), 0))::bigint AS units_sold
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          WHERE o.status = 'completed'
          GROUP BY oi.product_id
          HAVING (SUM(oi.quantity) - COALESCE((
            SELECT SUM(ri.quantity)
            FROM order_return_items ri
            INNER JOIN order_returns r ON r.id = ri.return_id
            WHERE ri.product_id = oi.product_id AND r.status = 'complete'
          ), 0)) > 0
          ORDER BY units_sold DESC
          LIMIT 5
        ) bs
        LEFT JOIN catalog_products p ON p.id = bs.product_id
      ) t
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION get_admin_dashboard_order_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_admin_dashboard_order_stats() TO service_role;
