import { Router } from 'express';
import { getProductPriceCents, type CatalogProduct } from '@voicex/shared';
import { supabaseAdmin } from '../../lib/supabase.js';
import { getThumbnailPublicUrl } from '../../lib/product-images.js';
import { getDefaultMarkupPercent } from '../../lib/product-price-alerts.js';

export const dashboardRouter = Router();

function catalogSliceForPricing(row: {
  product_id: string;
  amazon_price_cents: number | null;
  custom_price_cents: number | null;
  local_price_cents: number | null;
}): CatalogProduct {
  return {
    id: row.product_id,
    voicex_id: '',
    amazon_asin: '',
    amazon_url: '',
    amazon_name: null,
    amazon_description: null,
    amazon_price_cents: row.amazon_price_cents,
    voice_name: null,
    voice_description: null,
    custom_price_cents: row.custom_price_cents,
    local_price_cents: row.local_price_cents,
    amazon_star_rating: null,
    amazon_ratings_total: null,
    amazon_image_urls: null,
    thumbnail_path: null,
    status: 'active',
    lifetime_qty_sold: 0,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    deleted_by: null,
  };
}

dashboardRouter.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin.rpc('get_admin_dashboard_order_stats');

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const raw = data as Record<string, unknown> | null;
  if (!raw) {
    res.json({ success: true, data: null });
    return;
  }

  const markupPercent = await getDefaultMarkupPercent();
  const bestSellers = Array.isArray(raw.best_sellers) ? raw.best_sellers : [];

  const enrichedSellers = bestSellers.map((row: Record<string, unknown>) => {
    const productId = String(row.product_id ?? '');
    const markupPriceCents = getProductPriceCents(
      catalogSliceForPricing({
        product_id: productId,
        amazon_price_cents: row.amazon_price_cents != null ? Number(row.amazon_price_cents) : null,
        custom_price_cents: row.custom_price_cents != null ? Number(row.custom_price_cents) : null,
        local_price_cents: row.local_price_cents != null ? Number(row.local_price_cents) : null,
      }),
      markupPercent,
      false,
    );

    return {
      ...row,
      thumbnail_url: getThumbnailPublicUrl(
        row.thumbnail_path != null ? String(row.thumbnail_path) : null,
      ),
      markup_price_cents: markupPriceCents,
    };
  });

  res.json({
    success: true,
    data: {
      ...raw,
      best_sellers: enrichedSellers,
    },
  });
});
