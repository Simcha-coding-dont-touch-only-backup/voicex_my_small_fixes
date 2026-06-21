import { Router } from 'express';
import { ACTIVE_RETURN_STATUSES, weekLabel } from '@voicex/shared';
import { supabaseAdmin } from '../../lib/supabase.js';
import { fetchAllRows } from '../../lib/fetch-all-rows.js';
import { getThumbnailPublicUrl } from '../../lib/product-images.js';
import * as XLSX from 'xlsx';

export const reportsRouter = Router();

// ---- Subscription report helpers ----

async function decorateUsers(userIds: string[]): Promise<Map<string, { name: string; email: string | null; phone: string | null }>> {
  const map = new Map<string, { name: string; email: string | null; phone: string | null }>();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return map;
  const [{ data: users }, { data: phones }] = await Promise.all([
    supabaseAdmin.from('users').select('id, name, email').in('id', ids),
    supabaseAdmin.from('user_phones').select('user_id, phone_number, is_primary').in('user_id', ids),
  ]);
  const phoneByUser = new Map<string, string>();
  for (const p of phones || []) {
    if (!phoneByUser.has(p.user_id) || p.is_primary) phoneByUser.set(p.user_id, p.phone_number);
  }
  for (const u of users || []) map.set(u.id, { name: u.name, email: u.email, phone: phoneByUser.get(u.id) ?? null });
  return map;
}

function rangeFilter(query: any, column: string, dateFrom?: string, dateTo?: string) {
  if (dateFrom) query = query.gte(column, dateFrom);
  if (dateTo) query = query.lte(column, `${dateTo}T23:59:59.999Z`);
  return query;
}

// Monthly Subscription Revenue: processed + partial runs in range.
reportsRouter.get('/subscription-revenue', async (req, res) => {
  const { date_from, date_to } = req.query as Record<string, string>;
  const { data, error } = await fetchAllRows<any>(() =>
    rangeFilter(
      supabaseAdmin
        .from('subscription_delivery_runs')
        .select('*, subscription_delivery_run_items(quantity, amazon_price_cents, unit_price_cents, status)')
        .in('status', ['processed', 'partial']),
      'processed_at', date_from, date_to,
    ).order('processed_at', { ascending: false }),
  );
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }

  const users = await decorateUsers((data || []).map((r: any) => r.user_id));
  let gProducts = 0, gOrder = 0, gAmazon = 0, gProfit = 0;
  const rows = (data || []).map((r: any) => {
    const included = (r.subscription_delivery_run_items || []).filter((i: any) => i.status === 'included' || i.status === 'reduced');
    const products = included.length;
    const amazon = included.reduce((s: number, i: any) => s + i.amazon_price_cents * i.quantity, 0);
    const orderTotal = r.total_cents || 0;
    const profit = orderTotal - amazon;
    gProducts += products; gOrder += orderTotal; gAmazon += amazon; gProfit += profit;
    const u = users.get(r.user_id);
    return {
      status: r.status, order_id: r.order_id, week: r.week_number, week_label: weekLabel(r.week_number),
      customer_name: u?.name || 'Unknown', email: u?.email || null, phone: u?.phone || null,
      total_products: products, order_total_cents: orderTotal, amazon_total_cents: amazon, profit_cents: profit,
      processed_at: r.processed_at,
    };
  });
  res.json({ success: true, data: rows, totals: { total_products: gProducts, order_total_cents: gOrder, amazon_total_cents: gAmazon, profit_cents: gProfit } });
});

// Paused Subscriptions: temp + perm paused deliveries (by paused_at) in range.
reportsRouter.get('/subscription-paused', async (req, res) => {
  const { date_from, date_to } = req.query as Record<string, string>;
  const { data, error } = await fetchAllRows<any>(() =>
    rangeFilter(
      supabaseAdmin
        .from('subscription_deliveries')
        .select('*, subscriptions(user_id), subscription_delivery_items(quantity, product_id, catalog_products(custom_price_cents, amazon_price_cents))')
        .in('status', ['temp_paused', 'perm_paused']),
      'paused_at', date_from, date_to,
    ).order('paused_at', { ascending: false }),
  );
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }

  const users = await decorateUsers((data || []).map((d: any) => d.subscriptions?.user_id));
  let gProducts = 0, gOrder = 0;
  const rows = (data || []).map((d: any) => {
    const items = d.subscription_delivery_items || [];
    const products = items.length;
    const orderTotal = items.reduce((s: number, i: any) => {
      const p = i.catalog_products;
      const unit = p?.custom_price_cents ?? p?.amazon_price_cents ?? 0;
      return s + unit * i.quantity;
    }, 0);
    gProducts += products; gOrder += orderTotal;
    const u = users.get(d.subscriptions?.user_id);
    return {
      status: d.status, week: d.week_number, week_label: weekLabel(d.week_number),
      customer_name: u?.name || 'Unknown', email: u?.email || null, phone: u?.phone || null,
      total_products: products, order_total_cents: orderTotal, paused_at: d.paused_at,
    };
  });
  res.json({ success: true, data: rows, totals: { total_products: gProducts, order_total_cents: gOrder } });
});

// Failed Subscriptions: failed runs in range + failure rate.
reportsRouter.get('/subscription-failed', async (req, res) => {
  const { date_from, date_to } = req.query as Record<string, string>;
  const fetchByStatus = (statuses: string[], column: string) =>
    fetchAllRows<any>(() =>
      rangeFilter(
        supabaseAdmin.from('subscription_delivery_runs').select('*, subscription_delivery_run_items(quantity, status)').in('status', statuses),
        column, date_from, date_to,
      ).order(column, { ascending: false }),
    );

  const [{ data: failed, error: e1 }, { data: success, error: e2 }] = await Promise.all([
    fetchByStatus(['failed'], 'processed_at'),
    fetchByStatus(['processed', 'partial'], 'processed_at'),
  ]);
  if (e1 || e2) { res.status(500).json({ success: false, error: (e1 || e2)!.message }); return; }

  const users = await decorateUsers((failed || []).map((r: any) => r.user_id));
  let gProducts = 0, gOrder = 0;
  const rows = (failed || []).map((r: any) => {
    const items = r.subscription_delivery_run_items || [];
    const products = items.length;
    const orderTotal = r.total_cents || 0;
    gProducts += products; gOrder += orderTotal;
    const u = users.get(r.user_id);
    return {
      week: r.week_number, week_label: weekLabel(r.week_number),
      customer_name: u?.name || 'Unknown', email: u?.email || null, phone: u?.phone || null,
      total_products: products, order_total_cents: orderTotal, processed_at: r.processed_at,
      failure_details: r.failure_details || null,
    };
  });
  const failedCount = (failed || []).length;
  const successCount = (success || []).length;
  const denom = failedCount + successCount;
  const failureRate = denom > 0 ? (failedCount / denom) * 100 : 0;
  res.json({ success: true, data: rows, totals: { total_products: gProducts, order_total_cents: gOrder, failure_rate: Number(failureRate.toFixed(1)), failed_count: failedCount, success_count: successCount } });
});

// Most-Subscribed Products: products in processed/partial runs in range.
reportsRouter.get('/subscription-products', async (req, res) => {
  const { date_from, date_to } = req.query as Record<string, string>;
  const { data: runs, error } = await fetchAllRows<any>(() =>
    rangeFilter(
      supabaseAdmin
        .from('subscription_delivery_runs')
        .select('id, user_id, week_number, delivery_id, subscription_delivery_run_items(product_id, voicex_id, product_name, quantity, status, catalog_products(amazon_asin, thumbnail_path, voice_name, amazon_name))')
        .in('status', ['processed', 'partial']),
      'processed_at', date_from, date_to,
    ),
  );
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }

  // Aggregate per product.
  const agg = new Map<string, any>();
  for (const run of runs || []) {
    for (const it of run.subscription_delivery_run_items || []) {
      if (it.status !== 'included' && it.status !== 'reduced') continue;
      if (!it.product_id) continue;
      let row = agg.get(it.product_id);
      if (!row) {
        row = {
          product_id: it.product_id, voicex_id: it.voicex_id, product_name: it.product_name,
          amazon_asin: it.catalog_products?.amazon_asin || null,
          thumbnail_url: getThumbnailPublicUrl(it.catalog_products?.thumbnail_path ?? null),
          quantity: 0, deliveries: new Set<string>(), subscribers: new Set<string>(), breakdown: new Map<string, Map<number, number>>(),
        };
        agg.set(it.product_id, row);
      }
      row.quantity += it.quantity;
      row.deliveries.add(run.delivery_id);
      row.subscribers.add(run.user_id);
      if (!row.breakdown.has(run.user_id)) row.breakdown.set(run.user_id, new Map());
      const wk = row.breakdown.get(run.user_id);
      wk.set(run.week_number, (wk.get(run.week_number) || 0) + it.quantity);
    }
  }

  const allUserIds = Array.from(new Set(Array.from(agg.values()).flatMap((r: any) => Array.from(r.subscribers))));
  const users = await decorateUsers(allUserIds as string[]);

  const rows = Array.from(agg.values()).map((r: any) => ({
    product_id: r.product_id, voicex_id: r.voicex_id, product_name: r.product_name, amazon_asin: r.amazon_asin, thumbnail_url: r.thumbnail_url,
    quantity: r.quantity, deliveries: r.deliveries.size, subscribers: r.subscribers.size,
    subscriber_detail: Array.from(r.breakdown.entries() as Iterable<[string, Map<number, number>]>).map(([uid, weeks]) => ({
      name: users.get(uid)?.name || 'Unknown',
      weeks: Array.from(weeks.entries()).map(([w, q]) => `${weekLabel(w)} x${q}`),
    })),
  })).sort((a, b) => b.quantity - a.quantity);

  res.json({ success: true, data: rows });
});

reportsRouter.get('/purchases', async (req, res) => {
  const { date_from, date_to, sort_dir = 'desc' } = req.query;
  const sortAscending = sort_dir === 'asc';

  // Returned wholesale to the UI with no pagination, so page through the full
  // result set rather than letting PostgREST cap it at 1000 rows.
  const { data, error, truncated } = await fetchAllRows<any>(() => {
    let query = supabaseAdmin
      .from('order_items')
      .select('*, orders!inner(created_at, status, user_id, users(name))');

    if (date_from) query = query.gte('orders.created_at', date_from as string);
    if (date_to) query = query.lte('orders.created_at', `${date_to}T23:59:59.999Z`);

    return query.order('created_at', { ascending: sortAscending, referencedTable: 'orders' });
  });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data, truncated });
});

reportsRouter.get('/purchases/export', async (req, res) => {
  const { date_from, date_to } = req.query;

  // A spreadsheet export MUST contain every matching row — a silent 1000-row
  // cap here would produce incomplete financial reports.
  const { data, error } = await fetchAllRows<any>(() => {
    let query = supabaseAdmin
      .from('order_items')
      .select('*, orders!inner(created_at, status, user_id, users(name))');

    if (date_from) query = query.gte('orders.created_at', date_from as string);
    if (date_to) query = query.lte('orders.created_at', `${date_to}T23:59:59.999Z`);

    return query.order('created_at', { ascending: false, referencedTable: 'orders' });
  });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const rows = (data || []).map((item: any) => ({
    'Order Date': new Date(item.orders.created_at).toLocaleDateString(),
    'Customer': item.orders.users?.name || 'N/A',
    'Product': item.product_name,
    'VoiceX ID': item.voicex_id,
    'Quantity': item.quantity,
    'Unit Price': (item.unit_price_cents / 100).toFixed(2),
    'Amazon Price': (item.amazon_price_cents / 100).toFixed(2),
    'Markup %': item.markup_percent,
    'Total': ((item.unit_price_cents * item.quantity) / 100).toFixed(2),
    'Order Status': item.orders.status,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Purchases');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=purchases-report.xlsx');
  res.send(buffer);
});

// Returned items report. Mirrors the purchase report but rows are returned
// line items. Voided returns (cancelled/rejected/deleted) are excluded.
const RETURNED_ITEMS_SELECT =
  '*, order_returns!inner(id, created_at, status, order_id, user_id, users(name))';

function returnedItemsQuery(dateFrom?: string, dateTo?: string, ascending = false) {
  let query = supabaseAdmin
    .from('order_return_items')
    .select(RETURNED_ITEMS_SELECT)
    .in('order_returns.status', [...ACTIVE_RETURN_STATUSES]);

  if (dateFrom) query = query.gte('order_returns.created_at', dateFrom);
  if (dateTo) query = query.lte('order_returns.created_at', `${dateTo}T23:59:59.999Z`);

  return query.order('created_at', { ascending, referencedTable: 'order_returns' });
}

reportsRouter.get('/returned-items', async (req, res) => {
  const { date_from, date_to, sort_dir = 'desc' } = req.query;
  const ascending = sort_dir === 'asc';

  const { data, error, truncated } = await fetchAllRows<any>(() =>
    returnedItemsQuery(date_from as string | undefined, date_to as string | undefined, ascending),
  );

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data, truncated });
});

reportsRouter.get('/returned-items/export', async (req, res) => {
  const { date_from, date_to } = req.query;

  const { data, error } = await fetchAllRows<any>(() =>
    returnedItemsQuery(date_from as string | undefined, date_to as string | undefined, false),
  );

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const rows = (data || []).map((item: any) => ({
    'Return Date': new Date(item.order_returns.created_at).toLocaleDateString(),
    'Return #': item.order_returns.id,
    'Order #': item.order_returns.order_id,
    'Customer': item.order_returns.users?.name || 'N/A',
    'Product': item.product_name,
    'VoiceX ID': item.voicex_id,
    'Quantity': item.quantity,
    'Unit Price': (item.unit_price_cents / 100).toFixed(2),
    'Amazon Price': (item.amazon_price_cents / 100).toFixed(2),
    'Item Subtotal': ((item.unit_price_cents * item.quantity) / 100).toFixed(2),
    'Return Status': item.order_returns.status,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Returned Items');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=returned-items-report.xlsx');
  res.send(buffer);
});

// Product Sync: all sync runs (auto / manual / checkout) with their changed
// items, decorated with product names and (for checkout runs) customer/order.
reportsRouter.get('/product-sync', async (req, res) => {
  const { date_from, date_to, trigger } = req.query as Record<string, string>;

  let query = supabaseAdmin
    .from('product_sync_runs')
    .select('*, product_sync_run_items(*)');
  if (trigger && trigger !== 'all') query = query.eq('trigger', trigger);
  query = rangeFilter(query, 'started_at', date_from, date_to).order('started_at', { ascending: false });

  const { data, error } = await fetchAllRows<any>(() => query);
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }

  const runs = data || [];

  // Resolve product names for all changed items.
  const productIds = Array.from(
    new Set(runs.flatMap((r: any) => (r.product_sync_run_items || []).map((i: any) => i.product_id))),
  );
  const productMap = new Map<string, { voicex_id: string; name: string }>();
  if (productIds.length > 0) {
    const { data: products } = await supabaseAdmin
      .from('catalog_products')
      .select('id, voicex_id, voice_name, amazon_name')
      .in('id', productIds);
    for (const p of products || []) {
      productMap.set(p.id, { voicex_id: p.voicex_id, name: p.voice_name || p.amazon_name || p.voicex_id });
    }
  }

  const users = await decorateUsers(runs.map((r: any) => r.user_id).filter(Boolean));

  const rows = runs.map((r: any) => {
    const u = r.user_id ? users.get(r.user_id) : undefined;
    const items = (r.product_sync_run_items || []).map((i: any) => {
      const prod = productMap.get(i.product_id);
      return {
        product_id: i.product_id,
        voicex_id: prod?.voicex_id || null,
        product_name: prod?.name || 'Unknown product',
        old_amazon_price_cents: i.old_amazon_price_cents,
        new_amazon_price_cents: i.new_amazon_price_cents,
        direction: i.direction,
        became_unavailable: i.became_unavailable,
      };
    });
    const itemCount = items.length;
    const changed_count = Math.max(r.changed_count ?? 0, itemCount);
    let processed_count = r.processed_count ?? 0;
    if (processed_count === 0) {
      if (r.status === 'completed') {
        processed_count = r.total_count ?? 0;
      }
    }
    return {
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      actor_kind: r.actor_kind,
      actor_label: r.actor_label,
      total_count: r.total_count,
      processed_count,
      changed_count,
      started_at: r.started_at,
      finished_at: r.finished_at,
      order_id: r.order_id,
      caller_phone: r.caller_phone,
      customer_name: u?.name || null,
      customer_email: u?.email || null,
      customer_phone: u?.phone || r.caller_phone || null,
      items,
    };
  });

  res.json({ success: true, data: rows });
});
