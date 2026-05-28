import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { fetchAmazonProduct, RainforestProductLookupError } from '../../lib/rainforest.js';
import {
  downloadAndStoreFeaturedThumbnail,
  pickFeaturedImageUrl,
  getThumbnailPublicUrl,
  deleteThumbnailsForAsin,
  type ProductImageInput,
} from '../../lib/product-images.js';
import { syncProductVoicexPriceAboveLocalAlert } from '../../lib/product-price-alerts.js';
import { fetchAllRows } from '../../lib/fetch-all-rows.js';

function decorateProductWithThumbnail<T extends { thumbnail_path?: string | null }>(p: T): T & { thumbnail_url: string | null } {
  return { ...p, thumbnail_url: getThumbnailPublicUrl(p.thumbnail_path ?? null) };
}

const DUPLICATE_ASIN_IN_CATALOG_MESSAGE =
  'A product with this ASIN already exists in your catalog.';

/** Escape `,` and `\\` for values embedded in PostgREST `.or(...)` filter lists. */
function escapePostgrestOrFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,');
}

/**
 * If the whole trimmed string is a plain number or $money amount, return USD cents; otherwise null.
 * Integer strings are treated as cents (matches DB columns). Decimals are dollars (e.g. 1.79 → 179).
 */
function parsePriceSearchCents(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const normalized = t.replace(/^\$\s*/, '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) return null;
  if (normalized.includes('.')) {
    const v = parseFloat(normalized);
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 100);
  }
  const cents = parseInt(normalized, 10);
  return Number.isFinite(cents) ? cents : null;
}

/**
 * Amazon cents A where Math.round(A * (1 + markupPercent / 100)) === targetCents (non-whitelisted VoiceX price).
 */
function amazonCentsMatchingVoicexRoundedPrice(targetCents: number, markupPercent: number): number[] {
  const factor = 1 + markupPercent / 100;
  const mid = Math.round(targetCents / factor);
  const out: number[] = [];
  const seen = new Set<number>();
  for (let a = Math.max(0, mid - 25); a <= mid + 25; a++) {
    if (Math.round(a * factor) === targetCents && !seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}

async function activeCatalogProductExistsForAsin(
  normalizedAsin: string
): Promise<{ ok: true; exists: boolean } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from('catalog_products')
    .select('id')
    .eq('amazon_asin', normalizedAsin)
    .is('deleted_at', null)
    .limit(1);
  if (error) return { ok: false, error: error.message };
  return { ok: true, exists: (data?.length ?? 0) > 0 };
}

export const catalogRouter = Router();

// --- Categories ---

catalogRouter.get('/categories', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('catalog_categories')
    .select('*')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data });
});

catalogRouter.post('/categories', async (req, res) => {
  const { name, parent_id, sort_order } = req.body;

  let depth = 0;
  if (parent_id) {
    const { data: parent } = await supabaseAdmin
      .from('catalog_categories')
      .select('depth')
      .eq('id', parent_id)
      .is('deleted_at', null)
      .single();

    if (!parent) {
      res.status(400).json({ success: false, error: 'Parent category not found' });
      return;
    }

    if (parent.depth >= 2) {
      res.status(400).json({ success: false, error: 'Maximum category depth is 3 levels' });
      return;
    }

    depth = parent.depth + 1;
  }

  const { data, error } = await supabaseAdmin
    .from('catalog_categories')
    .insert({ name, parent_id, depth, sort_order: sort_order || 0 })
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'create_category',
    entity_type: 'catalog_category',
    entity_id: data.id,
    changes: { name, parent_id },
  });

  res.status(201).json({ success: true, data });
});

catalogRouter.patch('/categories/:id', async (req, res) => {
  const { name, parent_id, sort_order } = req.body;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (parent_id !== undefined) updates.parent_id = parent_id;
  if (sort_order !== undefined) updates.sort_order = sort_order;

  const { data, error } = await supabaseAdmin
    .from('catalog_categories')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data });
});

catalogRouter.delete('/categories/:id', async (req, res) => {
  const adminUser = (req as any).adminUser;
  const id = req.params.id;

  // Block deletion (hard or soft) when the category still has ANY product
  // links — live OR soft-deleted. The category_id FK is ON DELETE CASCADE,
  // so a hard delete would silently destroy link rows pointing to
  // soft-deleted products; restoring those products from trash would then
  // bring them back without their prior category. Force the admin to
  // detach products first so the relationship is explicit.
  const { data: links, error: linkErr } = await supabaseAdmin
    .from('catalog_product_categories')
    .select('product_id, catalog_products!inner(id, deleted_at)')
    .eq('category_id', id);

  if (linkErr) {
    res.status(500).json({ success: false, error: linkErr.message });
    return;
  }

  const allLinks = links || [];
  if (allLinks.length > 0) {
    const liveCount = allLinks.filter((l: any) => l.catalog_products?.deleted_at == null).length;
    const trashedCount = allLinks.length - liveCount;

    let message: string;
    if (liveCount > 0 && trashedCount > 0) {
      message = `Category still contains ${liveCount} product(s) and ${trashedCount} trashed product(s). Remove them from the category before deleting.`;
    } else if (liveCount > 0) {
      message = `Category still contains ${liveCount} product(s). Remove them from the category before deleting.`;
    } else {
      message = `Category still contains ${trashedCount} trashed product(s). Restore and detach them, or permanently delete them from the trash, before deleting this category.`;
    }

    res.status(409).json({ success: false, error: message });
    return;
  }

  // Block deleting a category that still has live (non-deleted) child
  // categories. Same reasoning — restore should be deterministic.
  const { count: childCount, error: childErr } = await supabaseAdmin
    .from('catalog_categories')
    .select('id', { count: 'exact', head: true })
    .eq('parent_id', id)
    .is('deleted_at', null);

  if (childErr) {
    res.status(500).json({ success: false, error: childErr.message });
    return;
  }

  if ((childCount ?? 0) > 0) {
    res.status(409).json({
      success: false,
      error: `Category still contains ${childCount} sub-categor${childCount === 1 ? 'y' : 'ies'}. Remove them before deleting.`,
    });
    return;
  }

  if (adminUser?.role === 'super_admin') {
    const { error } = await supabaseAdmin
      .from('catalog_categories')
      .delete()
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_user_id: adminUser.id,
      action: 'hard_delete_category',
      entity_type: 'catalog_category',
      entity_id: id,
    });

    res.json({ success: true, message: 'Category deleted' });
    return;
  }

  // Sub-admin (and any non-super role): soft delete only.
  const { error } = await supabaseAdmin
    .from('catalog_categories')
    .update({ deleted_at: new Date().toISOString(), deleted_by: adminUser?.id ?? null })
    .eq('id', id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: adminUser?.id,
    action: 'soft_delete_category',
    entity_type: 'catalog_category',
    entity_id: id,
  });

  // Response copy must NOT reveal the soft-delete to sub-admins.
  res.json({ success: true, message: 'Category deleted' });
});

// --- Products ---

const PRODUCTS_SORTABLE_COLUMNS = ['created_at', 'voice_name', 'amazon_name', 'name_sort_key', 'amazon_price_cents', 'custom_price_cents', 'local_price_cents', 'is_active', 'voicex_id', 'id', 'amazon_asin', 'lifetime_qty_sold'];

catalogRouter.get('/products', async (req, res) => {
  const { page = '1', per_page = '20', search, category_id, category_ids, is_active, sort_by = 'created_at', sort_dir = 'desc' } = req.query;
  const sortColumn = PRODUCTS_SORTABLE_COLUMNS.includes(sort_by as string) ? (sort_by as string) : 'created_at';
  const sortAscending = sort_dir === 'asc';
  const offset = (parseInt(page as string) - 1) * parseInt(per_page as string);

  const categoryFilter: string[] = [];
  if (typeof category_ids === 'string' && category_ids.trim()) {
    categoryFilter.push(...category_ids.split(',').map((s) => s.trim()).filter(Boolean));
  }
  if (typeof category_id === 'string' && category_id.trim()) {
    categoryFilter.push(category_id.trim());
  }

  let allowedProductIds: string[] | null = null;
  if (categoryFilter.length > 0) {
    // This list becomes a `.in('id', ...)` filter on the products query below,
    // so it must be COMPLETE. A 1000-row cap here would silently hide products
    // from a large category. Page through the full set.
    const { data: links, error: linkErr } = await fetchAllRows<any>(() =>
      supabaseAdmin
        .from('catalog_product_categories')
        .select('product_id')
        .in('category_id', categoryFilter)
    );

    if (linkErr) {
      res.status(500).json({ success: false, error: linkErr.message });
      return;
    }
    allowedProductIds = Array.from(new Set((links || []).map((l: any) => l.product_id)));
    if (allowedProductIds.length === 0) {
      res.json({
        success: true,
        data: [],
        total: 0,
        page: parseInt(page as string),
        per_page: parseInt(per_page as string),
        total_pages: 0,
      });
      return;
    }
  }

  let query = supabaseAdmin
    .from('catalog_products')
    .select('*, catalog_product_categories(category_id, catalog_categories(name))', { count: 'exact' })
    .is('deleted_at', null);

  if (search && typeof search === 'string') {
    const term = search.trim();
    const esc = escapePostgrestOrFilterValue(term);
    const orParts = [
      `voice_name.ilike.%${esc}%`,
      `amazon_name.ilike.%${esc}%`,
      `voicex_id.ilike.%${esc}%`,
      `amazon_asin.ilike.%${esc}%`,
    ];
    const priceCents = parsePriceSearchCents(term);
    if (priceCents != null) {
      orParts.push(`amazon_price_cents.eq.${priceCents}`);
      orParts.push(`custom_price_cents.eq.${priceCents}`);
      orParts.push(`local_price_cents.eq.${priceCents}`);
      const { data: markupRow } = await supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', 'default_markup_percent')
        .maybeSingle();
      const markupPercent =
        markupRow?.value != null && String(markupRow.value).trim() !== ''
          ? parseFloat(String(markupRow.value))
          : 15;
      const m = Number.isFinite(markupPercent) ? markupPercent : 15;
      const amazonForComputed = amazonCentsMatchingVoicexRoundedPrice(priceCents, m);
      if (amazonForComputed.length > 0) {
        orParts.push(`and(custom_price_cents.is.null,amazon_price_cents.in.(${amazonForComputed.join(',')}))`);
      }
    }
    query = query.or(orParts.join(','));
  }
  if (is_active !== undefined) {
    query = query.eq('is_active', is_active === 'true');
  }
  if (allowedProductIds) {
    query = query.in('id', allowedProductIds);
  }

  const { data, count, error } = await query
    .order(sortColumn, { ascending: sortAscending })
    .range(offset, offset + parseInt(per_page as string) - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({
    success: true,
    data: (data || []).map(decorateProductWithThumbnail),
    total: count || 0,
    page: parseInt(page as string),
    per_page: parseInt(per_page as string),
    total_pages: Math.ceil((count || 0) / parseInt(per_page as string)),
  });
});

catalogRouter.get('/products/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('catalog_products')
    .select('*, catalog_product_categories(category_id, catalog_categories(name))')
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    res.status(404).json({ success: false, error: 'Product not found' });
    return;
  }

  res.json({ success: true, data: decorateProductWithThumbnail(data) });
});

catalogRouter.post('/products/lookup-asin', async (req, res) => {
  const { asin } = req.body;

  if (!asin || typeof asin !== 'string' || !/^[A-Z0-9]{10}$/.test(asin.trim().toUpperCase())) {
    res.status(400).json({ success: false, error: 'Please provide a valid 10-character Amazon ASIN.' });
    return;
  }

  const normalizedAsin = asin.trim().toUpperCase();

  const duplicateCheck = await activeCatalogProductExistsForAsin(normalizedAsin);
  if (!duplicateCheck.ok) {
    res.status(500).json({ success: false, error: duplicateCheck.error });
    return;
  }
  if (duplicateCheck.exists) {
    res.status(409).json({ success: false, error: DUPLICATE_ASIN_IN_CATALOG_MESSAGE });
    return;
  }

  try {
    const product = await fetchAmazonProduct(normalizedAsin);

    if (!product) {
      res.status(404).json({
        success: false,
        error: `Product with ASIN "${normalizedAsin}" was not found on Amazon.`,
      });
      return;
    }

    res.json({ success: true, data: product });
  } catch (err: any) {
    if (err instanceof RainforestProductLookupError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    res.status(502).json({
      success: false,
      error: `Failed to look up product: ${err?.message || 'Unknown error'}`,
    });
  }
});

catalogRouter.post('/products', async (req, res) => {
  const {
    voicex_id,
    amazon_asin,
    amazon_url,
    amazon_name,
    amazon_description,
    amazon_price_cents,
    amazon_star_rating,
    amazon_ratings_total,
    amazon_image_urls,
    voice_name,
    voice_description,
    custom_price_cents,
    local_price_cents,
    is_active,
    category_ids,
  } = req.body;

  if (typeof amazon_asin === 'string' && amazon_asin.trim()) {
    const normalizedCreateAsin = amazon_asin.trim().toUpperCase();
    const duplicateCheck = await activeCatalogProductExistsForAsin(normalizedCreateAsin);
    if (!duplicateCheck.ok) {
      res.status(500).json({ success: false, error: duplicateCheck.error });
      return;
    }
    if (duplicateCheck.exists) {
      res.status(409).json({ success: false, error: DUPLICATE_ASIN_IN_CATALOG_MESSAGE });
      return;
    }
  }

  // When voicex_id isn't supplied we let the catalog_products_voicex_seq
  // sequence (column default, see migration 20260512155848) hand one out.
  // The previous read-MAX-then-insert approach raced with concurrent calls
  // — most visibly from the spreadsheet importer running with concurrency 4.

  const images: ProductImageInput[] | null = Array.isArray(amazon_image_urls)
    ? amazon_image_urls
        .filter((img: any) => img && typeof img.url === 'string')
        .map((img: any) => ({ url: img.url, is_featured: !!img.is_featured }))
    : null;
  const featuredUrl = pickFeaturedImageUrl(images);
  const asinForStorage =
    typeof amazon_asin === 'string' && amazon_asin.trim()
      ? amazon_asin.trim().toUpperCase()
      : amazon_asin;
  const thumbnailPath = featuredUrl && asinForStorage
    ? await downloadAndStoreFeaturedThumbnail(asinForStorage, featuredUrl)
    : null;

  const insertPayload: Record<string, unknown> = {
    amazon_asin: asinForStorage,
    amazon_url,
    amazon_name,
    amazon_description,
    amazon_price_cents,
    amazon_star_rating: amazon_star_rating ?? null,
    amazon_ratings_total: amazon_ratings_total ?? null,
    amazon_image_urls: images,
    thumbnail_path: thumbnailPath,
    voice_name,
    voice_description,
    custom_price_cents,
    local_price_cents: local_price_cents ?? null,
    is_active: is_active ?? true,
  };
  if (typeof voicex_id === 'string' && voicex_id.trim()) {
    insertPayload.voicex_id = voicex_id;
  }

  const { data: product, error } = await supabaseAdmin
    .from('catalog_products')
    .insert(insertPayload)
    .select()
    .single();

  if (error || !product) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to create product' });
    return;
  }

  if (category_ids && category_ids.length > 0) {
    const links = category_ids.map((cid: string) => ({
      product_id: product.id,
      category_id: cid,
    }));
    await supabaseAdmin.from('catalog_product_categories').insert(links);
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'create_product',
    entity_type: 'catalog_product',
    entity_id: product.id,
    changes: { voicex_id: product.voicex_id, amazon_asin: asinForStorage },
  });

  void syncProductVoicexPriceAboveLocalAlert(product.id);

  res.status(201).json({ success: true, data: decorateProductWithThumbnail(product) });
});

catalogRouter.patch('/products/:id', async (req, res) => {
  const {
    voicex_id, amazon_asin, amazon_url, amazon_name, amazon_description,
    amazon_price_cents, amazon_star_rating, amazon_ratings_total,
    voice_name, voice_description, custom_price_cents, local_price_cents,
    is_active, category_ids,
  } = req.body;

  const updates: Record<string, unknown> = {};
  if (voicex_id !== undefined) updates.voicex_id = voicex_id;
  if (amazon_asin !== undefined) updates.amazon_asin = amazon_asin;
  if (amazon_url !== undefined) updates.amazon_url = amazon_url;
  if (amazon_name !== undefined) updates.amazon_name = amazon_name;
  if (amazon_description !== undefined) updates.amazon_description = amazon_description;
  if (amazon_price_cents !== undefined) updates.amazon_price_cents = amazon_price_cents;
  if (amazon_star_rating !== undefined) updates.amazon_star_rating = amazon_star_rating;
  if (amazon_ratings_total !== undefined) updates.amazon_ratings_total = amazon_ratings_total;
  if (voice_name !== undefined) updates.voice_name = voice_name;
  if (voice_description !== undefined) updates.voice_description = voice_description;
  if (custom_price_cents !== undefined) updates.custom_price_cents = custom_price_cents;
  if (local_price_cents !== undefined) updates.local_price_cents = local_price_cents;
  if (is_active !== undefined) updates.is_active = is_active;

  const { data, error } = await supabaseAdmin
    .from('catalog_products')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  if (category_ids !== undefined) {
    await supabaseAdmin.from('catalog_product_categories').delete().eq('product_id', req.params.id);
    if (category_ids.length > 0) {
      const links = category_ids.map((cid: string) => ({
        product_id: req.params.id,
        category_id: cid,
      }));
      await supabaseAdmin.from('catalog_product_categories').insert(links);
    }
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'update_product',
    entity_type: 'catalog_product',
    entity_id: req.params.id,
    changes: updates,
  });

  if (
    ['amazon_price_cents', 'custom_price_cents', 'local_price_cents'].some(
      (k) => Object.prototype.hasOwnProperty.call(req.body ?? {}, k),
    )
  ) {
    void syncProductVoicexPriceAboveLocalAlert(req.params.id);
  }

  res.json({ success: true, data: data ? decorateProductWithThumbnail(data) : data });
});

catalogRouter.delete('/products/:id', async (req, res) => {
  const adminUser = (req as any).adminUser;
  const id = req.params.id;

  if (adminUser?.role === 'super_admin') {
    const { data: existing } = await supabaseAdmin
      .from('catalog_products')
      .select('amazon_asin')
      .eq('id', id)
      .single();

    await supabaseAdmin.from('catalog_product_categories').delete().eq('product_id', id);

    const { error } = await supabaseAdmin
      .from('catalog_products')
      .delete()
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if (existing?.amazon_asin) {
      await deleteThumbnailsForAsin(existing.amazon_asin);
    }

    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_user_id: adminUser.id,
      action: 'hard_delete_product',
      entity_type: 'catalog_product',
      entity_id: id,
    });

    res.json({ success: true, message: 'Product deleted' });
    return;
  }

  // Sub-admin (and any non-super role): soft delete only. Keep the
  // product_categories link rows so a Restore brings the product back
  // attached to the same categories.
  const { error } = await supabaseAdmin
    .from('catalog_products')
    .update({ deleted_at: new Date().toISOString(), deleted_by: adminUser?.id ?? null })
    .eq('id', id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: adminUser?.id,
    action: 'soft_delete_product',
    entity_type: 'catalog_product',
    entity_id: id,
  });

  // Sub-admins must believe this was a permanent delete.
  res.json({ success: true, message: 'Product deleted' });
});

// --- Spreadsheet import: column-mapping templates ---

type ImportFieldKey =
  | 'asin'
  | 'voice_name'
  | 'voice_description'
  | 'custom_price'
  | 'local_price'
  | 'category';

const IMPORT_FIELD_KEYS: readonly ImportFieldKey[] = [
  'asin',
  'voice_name',
  'voice_description',
  'custom_price',
  'local_price',
  'category',
];

function isValidImportMapping(value: unknown): value is Array<{
  column_index: number;
  column_label: string;
  field: ImportFieldKey;
}> {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    if (typeof e.column_index !== 'number' || !Number.isInteger(e.column_index) || e.column_index < 0) return false;
    if (typeof e.column_label !== 'string') return false;
    if (typeof e.field !== 'string' || !IMPORT_FIELD_KEYS.includes(e.field as ImportFieldKey)) return false;
  }
  return true;
}

catalogRouter.get('/import-templates', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('catalog_import_templates')
    .select('id, name, description, mapping, created_by, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data: data ?? [] });
});

catalogRouter.post('/import-templates', async (req, res) => {
  const { name, description, mapping } = req.body ?? {};

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    res.status(400).json({ success: false, error: 'Template name is required.' });
    return;
  }
  if (trimmedName.length > 120) {
    res.status(400).json({ success: false, error: 'Template name must be 120 characters or fewer.' });
    return;
  }

  const trimmedDescription =
    typeof description === 'string' && description.trim() ? description.trim() : null;

  if (!isValidImportMapping(mapping)) {
    res.status(400).json({ success: false, error: 'Mapping must be a non-empty list of valid column entries.' });
    return;
  }
  if (mapping.length === 0) {
    res.status(400).json({ success: false, error: 'Mapping cannot be empty.' });
    return;
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('catalog_import_templates')
    .select('id')
    .ilike('name', trimmedName)
    .limit(1);

  if (existingError) {
    res.status(500).json({ success: false, error: existingError.message });
    return;
  }
  if ((existing?.length ?? 0) > 0) {
    res.status(409).json({ success: false, error: 'A template with that name already exists.' });
    return;
  }

  const adminUser = (req as any).adminUser;
  const { data, error } = await supabaseAdmin
    .from('catalog_import_templates')
    .insert({
      name: trimmedName,
      description: trimmedDescription,
      mapping,
      created_by: adminUser?.id ?? null,
    })
    .select('id, name, description, mapping, created_by, created_at, updated_at')
    .single();

  if (error || !data) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to save template.' });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: adminUser?.id,
    action: 'create_import_template',
    entity_type: 'catalog_import_template',
    entity_id: data.id,
    changes: { name: data.name },
  });

  res.status(201).json({ success: true, data });
});

catalogRouter.delete('/import-templates/:id', async (req, res) => {
  const adminUser = (req as any).adminUser;
  const { error } = await supabaseAdmin
    .from('catalog_import_templates')
    .delete()
    .eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: adminUser?.id,
    action: 'delete_import_template',
    entity_type: 'catalog_import_template',
    entity_id: req.params.id,
  });

  res.json({ success: true, message: 'Template deleted' });
});

// --- Spreadsheet import: per-row product create ---
//
// One product per request so the client can drive a progress bar and
// surface granular per-row errors. Always responds 200; the body's
// `status` field tells the client whether the row succeeded or failed.

catalogRouter.post('/products/import-row', async (req, res) => {
  const {
    row_number: rowNumberRaw,
    asin: asinRaw,
    voice_name,
    voice_description,
    custom_price_cents,
    local_price_cents,
    category_ids,
  } = req.body ?? {};

  const rowNumber =
    typeof rowNumberRaw === 'number' && Number.isFinite(rowNumberRaw) ? rowNumberRaw : 0;
  const asinForResponse =
    typeof asinRaw === 'string' ? asinRaw.trim().toUpperCase() : '';

  const fail = (error: string) => {
    res.json({
      success: false,
      status: 'failed',
      row_number: rowNumber,
      asin: asinForResponse,
      error,
    });
  };

  if (!asinForResponse) {
    fail('ASIN is required.');
    return;
  }
  if (!/^[A-Z0-9]{10}$/.test(asinForResponse)) {
    fail(`"${asinForResponse}" is not a valid 10-character Amazon ASIN.`);
    return;
  }

  const duplicateCheck = await activeCatalogProductExistsForAsin(asinForResponse);
  if (!duplicateCheck.ok) {
    fail(duplicateCheck.error);
    return;
  }
  if (duplicateCheck.exists) {
    fail(DUPLICATE_ASIN_IN_CATALOG_MESSAGE);
    return;
  }

  let amazonProduct;
  try {
    amazonProduct = await fetchAmazonProduct(asinForResponse);
  } catch (err: any) {
    if (err instanceof RainforestProductLookupError) {
      fail(err.message);
      return;
    }
    fail(`Failed to look up product: ${err?.message || 'Unknown error'}`);
    return;
  }

  if (!amazonProduct) {
    fail(`Product with ASIN "${asinForResponse}" was not found on Amazon.`);
    return;
  }

  const images: ProductImageInput[] | null = Array.isArray(amazonProduct.images)
    ? amazonProduct.images
        .filter((img: any) => img && typeof img.url === 'string')
        .map((img: any) => ({ url: img.url, is_featured: !!img.is_featured }))
    : null;
  const featuredUrl = pickFeaturedImageUrl(images);
  const thumbnailPath = featuredUrl
    ? await downloadAndStoreFeaturedThumbnail(asinForResponse, featuredUrl)
    : null;

  // voicex_id is generated by the catalog_products_voicex_seq sequence
  // (see migration 20260512155848). Doing it server-side previously caused a
  // race when the spreadsheet importer ran rows with concurrency 4: two
  // requests would read the same MAX(voicex_id) and one of the inserts would
  // fail with a 23505 unique violation, surfacing as a row-level failure.
  const { data: product, error: insertError } = await supabaseAdmin
    .from('catalog_products')
    .insert({
      amazon_asin: asinForResponse,
      amazon_url: amazonProduct.url,
      amazon_name: amazonProduct.name,
      amazon_description: amazonProduct.description,
      amazon_price_cents: amazonProduct.price_cents,
      amazon_star_rating: amazonProduct.star_rating ?? null,
      amazon_ratings_total: amazonProduct.ratings_total ?? null,
      amazon_image_urls: images,
      thumbnail_path: thumbnailPath,
      voice_name: typeof voice_name === 'string' && voice_name.trim() ? voice_name : null,
      voice_description:
        typeof voice_description === 'string' && voice_description.trim() ? voice_description : null,
      custom_price_cents:
        typeof custom_price_cents === 'number' && Number.isFinite(custom_price_cents)
          ? Math.round(custom_price_cents)
          : null,
      local_price_cents:
        typeof local_price_cents === 'number' && Number.isFinite(local_price_cents)
          ? Math.round(local_price_cents)
          : null,
      is_active: true,
    })
    .select()
    .single();

  if (insertError || !product) {
    fail(insertError?.message || 'Failed to create product.');
    return;
  }

  if (Array.isArray(category_ids) && category_ids.length > 0) {
    const links = category_ids
      .filter((cid): cid is string => typeof cid === 'string' && cid.length > 0)
      .map((cid) => ({ product_id: product.id, category_id: cid }));
    if (links.length > 0) {
      const { error: linkError } = await supabaseAdmin
        .from('catalog_product_categories')
        .insert(links);
      if (linkError) {
        // The product was created; report the row as failed so the admin
        // knows category linking didn't take, but leave the product in
        // place (matches the resilient behavior of the regular create flow
        // which currently ignores link errors).
        fail(`Product created but failed to attach categories: ${linkError.message}`);
        return;
      }
    }
  }

  const adminUser = (req as any).adminUser;
  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: adminUser?.id,
    action: 'create_product',
    entity_type: 'catalog_product',
    entity_id: product.id,
    changes: {
      voicex_id: product.voicex_id,
      amazon_asin: asinForResponse,
      source: 'spreadsheet_import',
      row_number: rowNumber,
    },
  });

  void syncProductVoicexPriceAboveLocalAlert(product.id);

  res.json({
    success: true,
    status: 'created',
    row_number: rowNumber,
    asin: asinForResponse,
    product_id: product.id,
    voicex_id: product.voicex_id,
  });
});
