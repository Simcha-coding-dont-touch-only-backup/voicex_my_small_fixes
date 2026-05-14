import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';

export const supportRouter = Router();

const STATUS_VALUES = ['new', 'in_review', 'resolved', 'archived'] as const;
const ROLE_VALUES = ['merchant', 'investor', 'partner', 'press', 'other'] as const;
const SORTABLE_COLUMNS = ['created_at', 'updated_at', 'status', 'role', 'name', 'email'];

const updateSchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  admin_notes: z.string().max(10000).nullable().optional(),
});

function parsePositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function sanitizeSearch(value: unknown) {
  const search = typeof value === 'string' ? value.trim() : '';
  if (!search) return '';
  return search.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** Plain YYYY-MM-DD from query params → explicit UTC bounds; full ISO timestamps unchanged. */
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
function utcDayStartForFilter(value: unknown) {
  const s = String(value ?? '').trim();
  return ISO_DATE_ONLY.test(s) ? `${s}T00:00:00.000Z` : s;
}
function utcDayEndForFilter(value: unknown) {
  const s = String(value ?? '').trim();
  return ISO_DATE_ONLY.test(s) ? `${s}T23:59:59.999Z` : s;
}

supportRouter.get('/contact-submissions', async (req, res) => {
  const {
    page = '1',
    per_page = '20',
    status,
    role,
    date_from,
    date_to,
    search,
    sort_by = 'created_at',
    sort_dir = 'desc',
  } = req.query;

  const currentPage = parsePositiveInt(page, 1, 100000);
  const perPage = parsePositiveInt(per_page, 20, 1000);
  const offset = (currentPage - 1) * perPage;
  const sortColumn = SORTABLE_COLUMNS.includes(sort_by as string) ? (sort_by as string) : 'created_at';
  const sortAscending = sort_dir === 'asc';

  let query = supabaseAdmin
    .from('contact_submissions')
    .select('*', { count: 'exact' });

  if (STATUS_VALUES.includes(status as (typeof STATUS_VALUES)[number])) {
    query = query.eq('status', status as string);
  }
  if (ROLE_VALUES.includes(role as (typeof ROLE_VALUES)[number])) {
    query = query.eq('role', role as string);
  }
  if (date_from) {
    query = query.gte('created_at', utcDayStartForFilter(date_from));
  }
  if (date_to) {
    query = query.lte('created_at', utcDayEndForFilter(date_to));
  }

  const safeSearch = sanitizeSearch(search);
  if (safeSearch) {
    const term = `%${safeSearch}%`;
    query = query.or(`name.ilike.${term},email.ilike.${term},company.ilike.${term},message.ilike.${term}`);
  }

  const { data, count, error } = await query
    .order(sortColumn, { ascending: sortAscending })
    .range(offset, offset + perPage - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({
    success: true,
    data,
    total: count || 0,
    page: currentPage,
    per_page: perPage,
    total_pages: Math.ceil((count || 0) / perPage),
  });
});

supportRouter.get('/contact-submissions/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('contact_submissions')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) {
    res.status(404).json({ success: false, error: 'Contact submission not found' });
    return;
  }

  res.json({ success: true, data });
});

supportRouter.patch('/contact-submissions/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid update',
    });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status;
    if (parsed.data.status !== 'new') {
      updates.handled_by = req.adminUser?.id ?? null;
      updates.handled_at = new Date().toISOString();
    }
  }
  if (parsed.data.admin_notes !== undefined) {
    updates.admin_notes = parsed.data.admin_notes || null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ success: false, error: 'No updates provided' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('contact_submissions')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error || !data) {
    res.status(404).json({ success: false, error: 'Contact submission not found' });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: req.adminUser?.id,
    action: 'update_contact_submission',
    entity_type: 'contact_submission',
    entity_id: data.id,
    changes: updates,
  });

  res.json({ success: true, data });
});
