import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { fetchAllRows } from '../../lib/fetch-all-rows.js';
import * as XLSX from 'xlsx';

export const reportsRouter = Router();

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
