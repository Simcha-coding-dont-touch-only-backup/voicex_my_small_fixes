import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { refreshUserReturnState } from '../../lib/returns.js';

export const returnsRouter = Router();

const RETURNS_SORTABLE_COLUMNS = ['created_at', 'status', 'id', 'order_id', 'item_subtotal_cents'];

const RETURN_LIST_SELECT =
  '*, users(name, email), orders(id, created_at, status), order_return_items(quantity, unit_price_cents), order_return_fees(amount_cents)';
const RETURN_DETAIL_SELECT =
  '*, users(name, email), orders(id, created_at, status, subtotal_cents, shipping_cents, tax_cents, total_cents), order_return_items(*), order_return_fees(*)';

/** Return ids are a BIGINT sequence (start 50001); accept any positive integer. */
function returnIdFromParam(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits === '') return null;
  const n = BigInt(digits);
  if (n <= 0n) return null;
  return digits;
}

const settableStatus = z.enum(['pending', 'processing', 'complete', 'cancelled', 'rejected']);

const feeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  amount_cents: z.coerce.number().int(),
});

const patchSchema = z.object({
  status: settableStatus.optional(),
  tax_refund_cents: z.coerce.number().int().min(0).optional(),
  amazon_refund_cents: z.coerce.number().int().min(0).optional(),
  refunded: z.boolean().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
  fees: z.array(feeSchema).max(50).optional(),
});

returnsRouter.get('/', async (req, res) => {
  const {
    page = '1',
    per_page = '20',
    status,
    user_id,
    date_from,
    date_to,
    sort_by = 'created_at',
    sort_dir = 'desc',
  } = req.query;

  const sortColumn = RETURNS_SORTABLE_COLUMNS.includes(sort_by as string) ? (sort_by as string) : 'created_at';
  const sortAscending = sort_dir === 'asc';
  const offset = (parseInt(page as string) - 1) * parseInt(per_page as string);

  let query = supabaseAdmin.from('order_returns').select(RETURN_LIST_SELECT, { count: 'exact' });

  if (status) query = query.eq('status', status as string);
  if (user_id) query = query.eq('user_id', user_id as string);
  if (date_from) query = query.gte('created_at', date_from as string);
  if (date_to) query = query.lte('created_at', `${date_to}T23:59:59.999Z`);

  const { data, count, error } = await query
    .order(sortColumn, { ascending: sortAscending })
    .range(offset, offset + parseInt(per_page as string) - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const rows = (data || []).map((row: any) => {
    const items = row.order_return_items || [];
    const fees = row.order_return_fees || [];
    const itemCount = items.length;
    const totalQty = items.reduce((sum: number, i: any) => sum + i.quantity, 0);
    const totalFeesCents = fees.reduce((sum: number, f: any) => sum + f.amount_cents, 0);
    return {
      ...row,
      item_count: itemCount,
      total_qty: totalQty,
      total_fees_cents: totalFeesCents,
      customer_refund_cents: row.item_subtotal_cents + row.tax_refund_cents,
    };
  });

  res.json({
    success: true,
    data: rows,
    total: count || 0,
    page: parseInt(page as string),
    per_page: parseInt(per_page as string),
    total_pages: Math.ceil((count || 0) / parseInt(per_page as string)),
  });
});

returnsRouter.get('/pending-count', async (_req, res) => {
  const { count, error } = await supabaseAdmin
    .from('order_returns')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data: { count: count || 0 } });
});

returnsRouter.get('/:id', async (req, res) => {
  const id = returnIdFromParam(req.params.id);
  if (!id) {
    res.status(404).json({ success: false, error: 'Return not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('order_returns')
    .select(RETURN_DETAIL_SELECT)
    .eq('id', id)
    .single();

  if (error || !data) {
    res.status(404).json({ success: false, error: 'Return not found' });
    return;
  }

  const fees = (data as any).order_return_fees || [];
  const totalFeesCents = fees.reduce((sum: number, f: any) => sum + f.amount_cents, 0);

  res.json({
    success: true,
    data: {
      ...data,
      total_fees_cents: totalFeesCents,
      customer_refund_cents: (data as any).item_subtotal_cents + (data as any).tax_refund_cents,
    },
  });
});

returnsRouter.patch('/:id', async (req, res) => {
  const id = returnIdFromParam(req.params.id);
  if (!id) {
    res.status(404).json({ success: false, error: 'Return not found' });
    return;
  }

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid body' });
    return;
  }

  const { data: existing, error: findErr } = await supabaseAdmin
    .from('order_returns')
    .select('id, user_id, order_id, status')
    .eq('id', id)
    .maybeSingle();

  if (findErr) {
    res.status(500).json({ success: false, error: findErr.message });
    return;
  }
  if (!existing) {
    res.status(404).json({ success: false, error: 'Return not found' });
    return;
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const { status, tax_refund_cents, amazon_refund_cents, refunded, notes, fees } = parsed.data;

  if (status !== undefined) {
    updates.status = status;
    updates.completed_at = status === 'complete' ? new Date().toISOString() : null;
  }
  if (tax_refund_cents !== undefined) updates.tax_refund_cents = tax_refund_cents;
  if (amazon_refund_cents !== undefined) updates.amazon_refund_cents = amazon_refund_cents;
  if (notes !== undefined) updates.notes = notes;
  if (refunded !== undefined) {
    updates.refunded = refunded;
    updates.refunded_at = refunded ? new Date().toISOString() : null;
  }

  const { error: updErr } = await supabaseAdmin.from('order_returns').update(updates).eq('id', id);
  if (updErr) {
    res.status(500).json({ success: false, error: updErr.message });
    return;
  }

  if (fees !== undefined) {
    await supabaseAdmin.from('order_return_fees').delete().eq('return_id', id);
    if (fees.length > 0) {
      const { error: feeErr } = await supabaseAdmin
        .from('order_return_fees')
        .insert(fees.map((f) => ({ return_id: id, name: f.name, amount_cents: f.amount_cents })));
      if (feeErr) {
        res.status(500).json({ success: false, error: feeErr.message });
        return;
      }
    }
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: req.adminUser?.id ?? null,
    action: 'update_return',
    entity_type: 'order_return',
    entity_id: id,
    changes: parsed.data,
  });

  if (status !== undefined && status !== existing.status) {
    await supabaseAdmin.from('order_events').insert({
      order_id: String(existing.order_id),
      status: existing.status,
      source: 'admin',
      details: { action: 'return_status_change', return_id: id, from: existing.status, to: status },
    });
    // Status moving in/out of the active set changes the user's active return count.
    await refreshUserReturnState(existing.user_id);
  }

  const { data: updated } = await supabaseAdmin
    .from('order_returns')
    .select(RETURN_DETAIL_SELECT)
    .eq('id', id)
    .single();

  res.json({ success: true, data: updated });
});

returnsRouter.delete('/:id', async (req, res) => {
  const id = returnIdFromParam(req.params.id);
  if (!id) {
    res.status(404).json({ success: false, error: 'Return not found' });
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from('order_returns')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle();

  if (!existing) {
    res.status(404).json({ success: false, error: 'Return not found' });
    return;
  }

  const { error } = await supabaseAdmin.from('order_returns').delete().eq('id', id);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: req.adminUser?.id ?? null,
    action: 'delete_return',
    entity_type: 'order_return',
    entity_id: id,
    changes: null,
  });

  // Deleting the return releases its reserved quantity; refresh the count + alert.
  await refreshUserReturnState(existing.user_id);

  res.json({ success: true, message: 'Return deleted' });
});
