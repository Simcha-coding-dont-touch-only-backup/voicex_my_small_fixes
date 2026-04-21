import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { ryeClient, fetchAmazonProductReviews } from '../../lib/rye.js';

export const catalogRouter = Router();

// --- Categories ---

catalogRouter.get('/categories', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('catalog_categories')
    .select('*')
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
  const { error } = await supabaseAdmin
    .from('catalog_categories')
    .delete()
    .eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, message: 'Category deleted' });
});

// --- Products ---

const PRODUCTS_SORTABLE_COLUMNS = ['created_at', 'voice_name', 'amazon_name', 'amazon_price_cents', 'custom_price_cents', 'local_price_cents', 'is_active', 'voicex_id', 'id'];

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
    const { data: links, error: linkErr } = await supabaseAdmin
      .from('catalog_product_categories')
      .select('product_id')
      .in('category_id', categoryFilter);

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
    .select('*, catalog_product_categories(category_id, catalog_categories(name))', { count: 'exact' });

  if (search) {
    query = query.or(`voice_name.ilike.%${search}%,amazon_name.ilike.%${search}%,voicex_id.ilike.%${search}%,amazon_asin.ilike.%${search}%`);
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
    data,
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
    .single();

  if (error || !data) {
    res.status(404).json({ success: false, error: 'Product not found' });
    return;
  }

  res.json({ success: true, data });
});

catalogRouter.post('/products/lookup-asin', async (req, res) => {
  const { asin } = req.body;

  if (!asin || typeof asin !== 'string' || !/^[A-Z0-9]{10}$/.test(asin.trim().toUpperCase())) {
    res.status(400).json({ success: false, error: 'Please provide a valid 10-character Amazon ASIN.' });
    return;
  }

  const url = `https://www.amazon.com/dp/${asin.trim().toUpperCase()}`;

  try {
    const [product, reviews] = await Promise.all([
      ryeClient.products.lookup({ url }),
      fetchAmazonProductReviews(asin.trim().toUpperCase()),
    ]);
    res.json({
      success: true,
      data: {
        asin: asin.trim().toUpperCase(),
        url,
        name: product.name || null,
        description: product.description || null,
        price_cents: product.price?.amountSubunits ?? null,
        currency: product.price?.currencyCode || 'USD',
        availability: product.availability || 'unknown',
        is_purchasable: product.isPurchasable ?? false,
        images: product.images?.map((img: any) => ({ url: img.url, is_featured: img.isFeatured })) || [],
        brand: product.brand || null,
        star_rating: reviews?.rating ?? null,
        ratings_total: reviews?.ratingsTotal ?? null,
      },
    });
  } catch (err: any) {
    const status = err.status || 500;
    const message =
      status === 404 ? `Product with ASIN "${asin}" was not found on Amazon.`
      : status === 401 ? 'Rye API authentication failed. Check your API key.'
      : `Failed to look up product: ${err.message || 'Unknown error'}`;
    res.status(status >= 500 ? 502 : status).json({ success: false, error: message });
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
    voice_name,
    voice_description,
    custom_price_cents,
    local_price_cents,
    is_active,
    category_ids,
  } = req.body;

  let finalVoicexId = voicex_id;
  if (!finalVoicexId) {
    const { data: allIds } = await supabaseAdmin
      .from('catalog_products')
      .select('voicex_id');
    const maxNumeric = (allIds || []).reduce((max: number, r: any) => {
      const n = parseInt(r.voicex_id, 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 1000);
    finalVoicexId = String(maxNumeric + 1).padStart(7, '0');
  }

  const { data: product, error } = await supabaseAdmin
    .from('catalog_products')
    .insert({
      voicex_id: finalVoicexId,
      amazon_asin,
      amazon_url,
      amazon_name,
      amazon_description,
      amazon_price_cents,
      amazon_star_rating: amazon_star_rating ?? null,
      amazon_ratings_total: amazon_ratings_total ?? null,
      voice_name,
      voice_description,
      custom_price_cents,
      local_price_cents: local_price_cents ?? null,
      is_active: is_active ?? true,
    })
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
    changes: { voicex_id: finalVoicexId, amazon_asin },
  });

  res.status(201).json({ success: true, data: product });
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

  res.json({ success: true, data });
});

catalogRouter.delete('/products/:id', async (req, res) => {
  await supabaseAdmin.from('catalog_product_categories').delete().eq('product_id', req.params.id);

  const { error } = await supabaseAdmin
    .from('catalog_products')
    .delete()
    .eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, message: 'Product deleted' });
});
