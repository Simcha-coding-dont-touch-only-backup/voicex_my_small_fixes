import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

/**
 * Trash router for soft-deleted catalog rows. Mounted under
 * `requireSuperAdmin` in routes.ts so sub-admins can never see or touch
 * the trash, even by guessing URLs.
 */
export const catalogTrashRouter = Router();

// --- Products ---

catalogTrashRouter.get('/products', async (_req, res) => {
  // Pull deleter name in a separate query so we don't depend on a
  // foreign-key relationship name in the embedded select.
  const { data, error } = await supabaseAdmin
    .from('catalog_products')
    .select('*, catalog_product_categories(category_id, catalog_categories(name))')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const deleterIds = Array.from(
    new Set((data || []).map((p: any) => p.deleted_by).filter(Boolean))
  ) as string[];

  let deleters: Record<string, { id: string; email: string; name: string | null }> = {};
  if (deleterIds.length > 0) {
    const { data: admins } = await supabaseAdmin
      .from('admin_users')
      .select('id, email, name')
      .in('id', deleterIds);
    deleters = Object.fromEntries((admins || []).map((a: any) => [a.id, a]));
  }

  const enriched = (data || []).map((p: any) => ({
    ...p,
    deleted_by_user: p.deleted_by ? deleters[p.deleted_by] ?? null : null,
  }));

  res.json({ success: true, data: enriched });
});

catalogTrashRouter.post('/products/restore', async (req, res) => {
  const ids = parseIds(req.body?.ids);
  if (!ids) {
    res.status(400).json({ success: false, error: 'ids must be a non-empty string array' });
    return;
  }

  const { error } = await supabaseAdmin
    .from('catalog_products')
    .update({ deleted_at: null, deleted_by: null })
    .in('id', ids);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser?.id,
    action: 'restore_product',
    entity_type: 'catalog_product',
    entity_id: null,
    changes: { ids },
  });

  res.json({ success: true, restored: ids.length });
});

catalogTrashRouter.delete('/products', async (req, res) => {
  const ids = parseIds(req.body?.ids);
  if (!ids) {
    res.status(400).json({ success: false, error: 'ids must be a non-empty string array' });
    return;
  }

  // Only allow hard-deleting rows that are already trashed. Prevents
  // accidentally bulk-deleting live products via this endpoint.
  const { data: existing, error: existErr } = await supabaseAdmin
    .from('catalog_products')
    .select('id')
    .in('id', ids)
    .not('deleted_at', 'is', null);

  if (existErr) {
    res.status(500).json({ success: false, error: existErr.message });
    return;
  }

  const validIds = (existing || []).map((r: any) => r.id as string);
  if (validIds.length === 0) {
    res.json({ success: true, deleted: 0 });
    return;
  }

  await supabaseAdmin.from('catalog_product_categories').delete().in('product_id', validIds);

  const { error } = await supabaseAdmin
    .from('catalog_products')
    .delete()
    .in('id', validIds);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser?.id,
    action: 'hard_delete_product',
    entity_type: 'catalog_product',
    entity_id: null,
    changes: { ids: validIds },
  });

  res.json({ success: true, deleted: validIds.length });
});

// --- Categories ---

catalogTrashRouter.get('/categories', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('catalog_categories')
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const deleterIds = Array.from(
    new Set((data || []).map((c: any) => c.deleted_by).filter(Boolean))
  ) as string[];

  let deleters: Record<string, { id: string; email: string; name: string | null }> = {};
  if (deleterIds.length > 0) {
    const { data: admins } = await supabaseAdmin
      .from('admin_users')
      .select('id, email, name')
      .in('id', deleterIds);
    deleters = Object.fromEntries((admins || []).map((a: any) => [a.id, a]));
  }

  const enriched = (data || []).map((c: any) => ({
    ...c,
    deleted_by_user: c.deleted_by ? deleters[c.deleted_by] ?? null : null,
  }));

  res.json({ success: true, data: enriched });
});

catalogTrashRouter.post('/categories/restore', async (req, res) => {
  const ids = parseIds(req.body?.ids);
  if (!ids) {
    res.status(400).json({ success: false, error: 'ids must be a non-empty string array' });
    return;
  }

  // If a category has a soft-deleted parent, restoring would create a
  // category that's invisible (its parent is in trash). Block that and
  // ask the admin to restore the parent first.
  const { data: rows, error: fetchErr } = await supabaseAdmin
    .from('catalog_categories')
    .select('id, name, parent_id')
    .in('id', ids);

  if (fetchErr) {
    res.status(500).json({ success: false, error: fetchErr.message });
    return;
  }

  const parentIds = Array.from(
    new Set((rows || []).map((r: any) => r.parent_id).filter(Boolean))
  ) as string[];

  const restoringIdSet = new Set(ids);

  if (parentIds.length > 0) {
    const { data: parents } = await supabaseAdmin
      .from('catalog_categories')
      .select('id, name, deleted_at')
      .in('id', parentIds);

    const parentById = new Map((parents || []).map((p: any) => [p.id, p]));

    for (const row of rows || []) {
      if (!row.parent_id) continue;
      const parent = parentById.get(row.parent_id);
      // Parent OK if not soft-deleted, or also being restored in this call.
      if (parent?.deleted_at && !restoringIdSet.has(row.parent_id)) {
        res.status(409).json({
          success: false,
          error: `Cannot restore "${row.name}" — its parent category "${parent.name}" is also deleted. Restore the parent first.`,
        });
        return;
      }
    }
  }

  const { error } = await supabaseAdmin
    .from('catalog_categories')
    .update({ deleted_at: null, deleted_by: null })
    .in('id', ids);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser?.id,
    action: 'restore_category',
    entity_type: 'catalog_category',
    entity_id: null,
    changes: { ids },
  });

  res.json({ success: true, restored: ids.length });
});

catalogTrashRouter.delete('/categories', async (req, res) => {
  const ids = parseIds(req.body?.ids);
  if (!ids) {
    res.status(400).json({ success: false, error: 'ids must be a non-empty string array' });
    return;
  }

  // Only allow hard-deleting categories that are already trashed.
  const { data: trashed, error: trashedErr } = await supabaseAdmin
    .from('catalog_categories')
    .select('id, name')
    .in('id', ids)
    .not('deleted_at', 'is', null);

  if (trashedErr) {
    res.status(500).json({ success: false, error: trashedErr.message });
    return;
  }

  const validIds = (trashed || []).map((r: any) => r.id as string);
  if (validIds.length === 0) {
    res.json({ success: true, deleted: 0 });
    return;
  }

  // Reject if any selected category still has ANY product links — live OR
  // soft-deleted. category_id FK is ON DELETE CASCADE, so a hard delete
  // would silently destroy links pointing to soft-deleted products and
  // restoring those products from trash would bring them back without
  // their prior category. Force the admin to detach products first.
  const { data: anyLinks, error: linkErr } = await supabaseAdmin
    .from('catalog_product_categories')
    .select('category_id, catalog_products!inner(id, deleted_at)')
    .in('category_id', validIds);

  if (linkErr) {
    res.status(500).json({ success: false, error: linkErr.message });
    return;
  }

  if ((anyLinks || []).length > 0) {
    const hasTrashedOnly = (anyLinks || []).every((l: any) => l.catalog_products?.deleted_at != null);
    const blockedIds = Array.from(new Set((anyLinks || []).map((l: any) => l.category_id)));
    const blockedNames = (trashed || [])
      .filter((c: any) => blockedIds.includes(c.id))
      .map((c: any) => c.name);
    const detail = hasTrashedOnly ? 'trashed products' : 'products';
    res.status(409).json({
      success: false,
      error: `Cannot permanently delete: still linked to ${detail}: ${blockedNames.join(', ')}. Detach them first.`,
    });
    return;
  }

  // Reject if any selected category still has live (non-deleted) child
  // categories.
  const { data: liveChildren, error: childErr } = await supabaseAdmin
    .from('catalog_categories')
    .select('id, parent_id, name')
    .in('parent_id', validIds)
    .is('deleted_at', null);

  if (childErr) {
    res.status(500).json({ success: false, error: childErr.message });
    return;
  }

  if ((liveChildren || []).length > 0) {
    res.status(409).json({
      success: false,
      error: `Cannot permanently delete: still has live sub-categories.`,
    });
    return;
  }

  // No need to pre-delete catalog_product_categories rows: the link
  // validation above guarantees there are none, and the FK is
  // ON DELETE CASCADE anyway.
  const { error } = await supabaseAdmin
    .from('catalog_categories')
    .delete()
    .in('id', validIds);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser?.id,
    action: 'hard_delete_category',
    entity_type: 'catalog_category',
    entity_id: null,
    changes: { ids: validIds },
  });

  res.json({ success: true, deleted: validIds.length });
});

function parseIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return ids.length > 0 ? ids : null;
}
