import { Router } from 'express';
import { z } from 'zod';
import {
  ADMIN_ALERT_TYPES,
  getProductPriceCents,
  isProductCatalogAlertType,
  isUserAlertType,
  PRODUCT_CATALOG_ALERT_TYPES,
  USER_ALERT_TYPES,
  type CatalogProduct,
} from '@voicex/shared';
import { supabaseAdmin } from '../../lib/supabase.js';
import { getThumbnailPublicUrl } from '../../lib/product-images.js';
import { getDefaultMarkupPercent } from '../../lib/product-price-alerts.js';

export const alertsRouter = Router();

const alertStatusZod = z.enum(['new', 'reviewing', 'resolved']);
const alertTypeZod = z.enum([
  ADMIN_ALERT_TYPES.PRODUCT_VOICEX_PRICE_ABOVE_LOCAL,
  ADMIN_ALERT_TYPES.PRODUCT_MISSING_AMAZON_PRICE,
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
        custom_price_cents, amazon_price_cents, local_price_cents
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
  if (!existing || (!isProductCatalogAlertType(existing.alert_type) && !isUserAlertType(existing.alert_type))) {
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
  if (!existing || (!isProductCatalogAlertType(existing.alert_type) && !isUserAlertType(existing.alert_type))) {
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
