import { Router } from 'express';
import { z } from 'zod';
import {
  ADMIN_ALERT_TYPES,
  getProductPriceCents,
  isProductCatalogAlertType,
  isUserAlertType,
  isSubscriptionAlertType,
  PRODUCT_CATALOG_ALERT_TYPES,
  USER_ALERT_TYPES,
  SUBSCRIPTION_ALERT_TYPES,
  type CatalogProduct,
} from '@voicex/shared';
import { supabaseAdmin } from '../../lib/supabase.js';
import { getThumbnailPublicUrl } from '../../lib/product-images.js';
import { getDefaultMarkupPercent } from '../../lib/product-price-alerts.js';
import { getOrCreateSubscription, getOrCreateDelivery } from '../../lib/subscriptions.js';
import { createFailedDeliveryAlert } from '../../lib/subscription-alerts.js';

export const alertsRouter = Router();

const alertStatusZod = z.enum(['new', 'reviewing', 'resolved']);
const alertTypeZod = z.enum([
  ADMIN_ALERT_TYPES.PRODUCT_VOICEX_PRICE_ABOVE_LOCAL,
  ADMIN_ALERT_TYPES.PRODUCT_MISSING_AMAZON_PRICE,
  ADMIN_ALERT_TYPES.PRODUCT_AMAZON_OUT_OF_STOCK,
  ADMIN_ALERT_TYPES.PRODUCT_ASIN_NOT_FOUND,
]);

const ALERTS_SORTABLE_COLUMNS = ['created_at', 'status', 'alert_type'] as const;
const alertSortByZod = z.enum(ALERTS_SORTABLE_COLUMNS);
const alertSortDirZod = z.enum(['asc', 'desc']);

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(1000).default(20),
  status: alertStatusZod.optional(),
  alert_type: alertTypeZod.optional(),
  sort_by: alertSortByZod.default('created_at'),
  sort_dir: alertSortDirZod.default('desc'),
});

const patchBodySchema = z.object({
  status: alertStatusZod,
});

const bulkPatchBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  status: alertStatusZod,
});

function parseAlertIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return ids.length > 0 ? ids : null;
}

function isValidAlertType(alertType: string): boolean {
  return (
    isProductCatalogAlertType(alertType) ||
    isUserAlertType(alertType) ||
    isSubscriptionAlertType(alertType)
  );
}

function decorateEmbeddedProduct<T extends { thumbnail_path?: string | null }>(
  p: T | null | undefined,
): (T & { thumbnail_url: string | null }) | null {
  if (!p) return null;
  return { ...p, thumbnail_url: getThumbnailPublicUrl(p.thumbnail_path ?? null) };
}

alertsRouter.get('/new-count', async (_req, res) => {
  const { count, error } = await supabaseAdmin
    .from('admin_alerts')
    .select('id', { count: 'exact', head: true })
    .in('alert_type', [...PRODUCT_CATALOG_ALERT_TYPES])
    .eq('status', 'new');

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data: { count: count ?? 0 } });
});

alertsRouter.get('/', async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid query' });
    return;
  }

  const { page, per_page, status, alert_type, sort_by, sort_dir } = parsed.data;
  const offset = (page - 1) * per_page;

  let query = supabaseAdmin
    .from('admin_alerts')
    .select(
      `*,
      catalog_products (
        id, voicex_id, amazon_asin, amazon_name, voice_name,
        thumbnail_path, amazon_image_urls, status, frozen_source, deleted_at,
        custom_price_cents, amazon_price_cents, local_price_cents, amazon_availability_status
      )`,
      { count: 'exact' },
    )
    .in('alert_type', [...PRODUCT_CATALOG_ALERT_TYPES])
    .order(sort_by, { ascending: sort_dir === 'asc' });

  if (status) {
    query = query.eq('status', status);
  }
  if (alert_type) {
    query = query.eq('alert_type', alert_type);
  }

  const { data, count, error } = await query.range(offset, offset + per_page - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const markupPercent = await getDefaultMarkupPercent();

  const rows = (data || []).map((row: any) => {
    const raw = row.catalog_products;
    const product = Array.isArray(raw) ? raw[0] : raw;
    const decorated = decorateEmbeddedProduct(product);
    let effective_custom_price_cents: number | null = null;
    if (
      decorated &&
      !decorated.deleted_at &&
      row.alert_type === ADMIN_ALERT_TYPES.PRODUCT_VOICEX_PRICE_ABOVE_LOCAL
    ) {
      effective_custom_price_cents = getProductPriceCents(
        decorated as CatalogProduct,
        markupPercent,
        false,
      );
    }
    return {
      ...row,
      catalog_products: decorated,
      effective_custom_price_cents,
    };
  });

  res.json({
    success: true,
    data: rows,
    total: count ?? 0,
    page,
    per_page,
    total_pages: Math.ceil((count ?? 0) / per_page),
  });
});

alertsRouter.get('/user/count', async (_req, res) => {
  const { count, error } = await supabaseAdmin
    .from('admin_alerts')
    .select('id', { count: 'exact', head: true })
    .in('alert_type', [...USER_ALERT_TYPES])
    .eq('status', 'new');

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data: { count: count ?? 0 } });
});

alertsRouter.get('/user', async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid query' });
    return;
  }

  const { page, per_page, status, sort_by, sort_dir } = parsed.data;
  const offset = (page - 1) * per_page;

  let query = supabaseAdmin
    .from('admin_alerts')
    .select('*', { count: 'exact' })
    .in('alert_type', [...USER_ALERT_TYPES])
    .order(sort_by, { ascending: sort_dir === 'asc' });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, count, error } = await query.range(offset, offset + per_page - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // entity_id has no FK to users, so the user is joined manually.
  const userIds = Array.from(new Set((data || []).map((a: any) => a.entity_id).filter(Boolean)));
  const usersById = new Map<string, any>();
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, name, email, status, returns_count')
      .in('id', userIds);
    for (const u of users || []) usersById.set(u.id, u);
  }

  const rows = (data || []).map((a: any) => ({ ...a, user: usersById.get(a.entity_id) ?? null }));

  res.json({
    success: true,
    data: rows,
    total: count ?? 0,
    page,
    per_page,
    total_pages: Math.ceil((count ?? 0) / per_page),
  });
});

const subscriptionAlertTypeZod = z.enum([
  ADMIN_ALERT_TYPES.SUBSCRIPTION_DELIVERY_ISSUE,
  ADMIN_ALERT_TYPES.SUBSCRIPTION_FAILED_DELIVERY,
]);

const subscriptionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(1000).default(20),
  status: alertStatusZod.optional(),
  alert_type: subscriptionAlertTypeZod.optional(),
  user_id: z.string().uuid().optional(),
  heard: z.enum(['heard', 'unheard']).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  sort_by: alertSortByZod.default('created_at'),
  sort_dir: alertSortDirZod.default('desc'),
});

// Subscription alert tabs (Delivery Issues + Failed Deliveries).
alertsRouter.get('/subscription', async (req, res) => {
  const parsed = subscriptionListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid query' });
    return;
  }
  const { page, per_page, status, alert_type, user_id, heard, date_from, date_to, sort_by, sort_dir } = parsed.data;
  const offset = (page - 1) * per_page;

  let query = supabaseAdmin
    .from('admin_alerts')
    .select('*', { count: 'exact' })
    .in('alert_type', alert_type ? [alert_type] : [...SUBSCRIPTION_ALERT_TYPES])
    .order(sort_by, { ascending: sort_dir === 'asc' });

  if (status) query = query.eq('status', status);
  if (user_id) query = query.eq('user_id', user_id);
  if (heard === 'heard') query = query.not('heard_at', 'is', null);
  if (heard === 'unheard') query = query.is('heard_at', null);
  if (date_from) query = query.gte('created_at', date_from as string);
  if (date_to) query = query.lte('created_at', `${date_to}T23:59:59.999Z`);

  const { data, count, error } = await query.range(offset, offset + per_page - 1);
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }

  // Join user (name/email/phone) since user_id has no embedded relation here.
  const userIds = Array.from(new Set((data || []).map((a: any) => a.user_id).filter(Boolean)));
  const usersById = new Map<string, any>();
  const phonesById = new Map<string, string>();
  if (userIds.length > 0) {
    const [{ data: users }, { data: phones }] = await Promise.all([
      supabaseAdmin.from('users').select('id, name, email').in('id', userIds),
      supabaseAdmin.from('user_phones').select('user_id, phone_number, is_primary').in('user_id', userIds),
    ]);
    for (const u of users || []) usersById.set(u.id, u);
    for (const p of phones || []) {
      if (!phonesById.has(p.user_id) || p.is_primary) phonesById.set(p.user_id, p.phone_number);
    }
  }

  const rows = (data || []).map((a: any) => ({
    ...a,
    user: a.user_id ? { ...(usersById.get(a.user_id) || {}), phone: phonesById.get(a.user_id) ?? null } : null,
  }));

  res.json({ success: true, data: rows, total: count ?? 0, page, per_page, total_pages: Math.ceil((count ?? 0) / per_page) });
});

const createSubscriptionAlertSchema = z.object({
  user_id: z.string().uuid(),
  week_number: z.coerce.number().int().min(1).max(4),
  admin_note: z.string().trim().max(5000).optional(),
  ivr_message: z.string().trim().max(2000).optional(),
});

// Manual Failed Delivery alert (the only manually-creatable type for now).
alertsRouter.post('/subscription', async (req, res) => {
  const parsed = createSubscriptionAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid body' });
    return;
  }
  const subscription = await getOrCreateSubscription(parsed.data.user_id);
  const delivery = await getOrCreateDelivery(subscription.id, parsed.data.week_number);
  const id = await createFailedDeliveryAlert({
    userId: parsed.data.user_id,
    deliveryId: delivery.id,
    weekNumber: parsed.data.week_number,
    issueType: 'other',
    adminNote: parsed.data.admin_note ?? null,
    ivrMessage: parsed.data.ivr_message ?? null,
  });
  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser?.id ?? null,
    action: 'create_manual_subscription_alert',
    entity_type: 'admin_alert',
    entity_id: id,
    changes: parsed.data,
  });
  res.json({ success: true, data: { id } });
});

alertsRouter.patch('/', async (req, res) => {
  const parsed = bulkPatchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid body' });
    return;
  }

  const { ids, status } = parsed.data;
  const resolved_at = status === 'resolved' ? new Date().toISOString() : null;

  const { data: existing, error: findErr } = await supabaseAdmin
    .from('admin_alerts')
    .select('id, alert_type')
    .in('id', ids);

  if (findErr) {
    res.status(500).json({ success: false, error: findErr.message });
    return;
  }

  const validIds = (existing || [])
    .filter((row: { alert_type: string }) => isValidAlertType(row.alert_type))
    .map((row: { id: string }) => row.id);

  if (validIds.length === 0) {
    res.status(404).json({ success: false, error: 'No alerts found' });
    return;
  }

  const { error } = await supabaseAdmin
    .from('admin_alerts')
    .update({
      status,
      resolved_at,
      updated_at: new Date().toISOString(),
    })
    .in('id', validIds);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'bulk_update_admin_alert_status',
    entity_type: 'admin_alert',
    entity_id: validIds[0],
    changes: { ids: validIds, status },
  });

  res.json({ success: true, updated: validIds.length });
});

alertsRouter.delete('/', async (req, res) => {
  const ids = parseAlertIds(req.body?.ids);
  if (!ids) {
    res.status(400).json({ success: false, error: 'ids must be a non-empty string array' });
    return;
  }

  const { data: existing, error: findErr } = await supabaseAdmin
    .from('admin_alerts')
    .select('id, alert_type')
    .in('id', ids);

  if (findErr) {
    res.status(500).json({ success: false, error: findErr.message });
    return;
  }

  const validIds = (existing || [])
    .filter((row: { alert_type: string }) => isValidAlertType(row.alert_type))
    .map((row: { id: string }) => row.id);

  if (validIds.length === 0) {
    res.json({ success: true, deleted: 0 });
    return;
  }

  const { error } = await supabaseAdmin.from('admin_alerts').delete().in('id', validIds);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'bulk_delete_admin_alerts',
    entity_type: 'admin_alert',
    entity_id: validIds[0],
    changes: { ids: validIds },
  });

  res.json({ success: true, deleted: validIds.length });
});

alertsRouter.patch('/:id', async (req, res) => {
  const parsed = patchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid body' });
    return;
  }

  const { status } = parsed.data;
  const resolved_at = status === 'resolved' ? new Date().toISOString() : null;

  const { data: existing, error: findErr } = await supabaseAdmin
    .from('admin_alerts')
    .select('id, alert_type')
    .eq('id', req.params.id)
    .maybeSingle();

  if (findErr) {
    res.status(500).json({ success: false, error: findErr.message });
    return;
  }
  if (!existing || !isValidAlertType(existing.alert_type)) {
    res.status(404).json({ success: false, error: 'Alert not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('admin_alerts')
    .update({
      status,
      resolved_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'update_admin_alert',
    entity_type: 'admin_alert',
    entity_id: req.params.id,
    changes: { status },
  });

  res.json({ success: true, data });
});

alertsRouter.delete('/:id', async (req, res) => {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('admin_alerts')
    .select('id, alert_type')
    .eq('id', req.params.id)
    .maybeSingle();

  if (findErr) {
    res.status(500).json({ success: false, error: findErr.message });
    return;
  }
  if (!existing || !isValidAlertType(existing.alert_type)) {
    res.status(404).json({ success: false, error: 'Alert not found' });
    return;
  }

  const { error } = await supabaseAdmin.from('admin_alerts').delete().eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'delete_admin_alert',
    entity_type: 'admin_alert',
    entity_id: req.params.id,
  });

  res.json({ success: true, message: 'Alert deleted' });
});
