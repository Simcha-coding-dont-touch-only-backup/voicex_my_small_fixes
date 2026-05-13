import {
  ADMIN_ALERT_TYPES,
  getProductPriceCents,
  SETTING_KEYS,
  type CatalogProduct,
  type ProductVoicexPriceAboveLocalPayload,
} from '@voicex/shared';
import { supabaseAdmin } from './supabase.js';

const ALERT_TYPE = ADMIN_ALERT_TYPES.PRODUCT_VOICEX_PRICE_ABOVE_LOCAL;

type ProductRow = Pick<
  CatalogProduct,
  | 'id'
  | 'voicex_id'
  | 'amazon_asin'
  | 'amazon_name'
  | 'voice_name'
  | 'custom_price_cents'
  | 'amazon_price_cents'
  | 'local_price_cents'
> & { deleted_at: string | null };

export async function getDefaultMarkupPercent(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', SETTING_KEYS.DEFAULT_MARKUP_PERCENT)
    .maybeSingle();

  if (error) {
    console.error('[product-price-alerts] Failed to load default markup:', error.message);
    return 15;
  }

  const raw = data?.value;
  if (raw == null || String(raw).trim() === '') return 15;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

function buildPayload(
  product: ProductRow,
  markupPercent: number,
  effectiveCents: number,
): ProductVoicexPriceAboveLocalPayload {
  return {
    voicex_id: product.voicex_id,
    amazon_asin: product.amazon_asin,
    voice_name: product.voice_name,
    amazon_name: product.amazon_name,
    effective_custom_price_cents: effectiveCents,
    custom_price_cents: product.custom_price_cents,
    amazon_price_cents: product.amazon_price_cents,
    local_price_cents: product.local_price_cents ?? 0,
    default_markup_percent: markupPercent,
  };
}

/**
 * Creates, updates, or resolves the VoiceX-vs-local price alert for one product.
 * Safe to call after any catalog write that might affect pricing.
 */
export async function syncProductVoicexPriceAboveLocalAlert(productId: string): Promise<void> {
  const markupPercent = await getDefaultMarkupPercent();

  const { data: product, error: productError } = await supabaseAdmin
    .from('catalog_products')
    .select(
      'id, deleted_at, voicex_id, amazon_asin, amazon_name, voice_name, custom_price_cents, amazon_price_cents, local_price_cents',
    )
    .eq('id', productId)
    .maybeSingle();

  if (productError) {
    console.error('[product-price-alerts] Failed to load product:', productError.message);
    return;
  }

  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('admin_alerts')
    .select('id, status')
    .eq('product_id', productId)
    .eq('alert_type', ALERT_TYPE)
    .limit(1);

  if (existingError) {
    console.error('[product-price-alerts] Failed to load existing alert:', existingError.message);
    return;
  }

  const existing = existingRows?.[0] as { id: string; status: string } | undefined;

  if (!product || product.deleted_at != null) {
    if (existing) {
      await supabaseAdmin
        .from('admin_alerts')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          title: 'VoiceX price above local retail',
          message: 'Product was removed or trashed; alert auto-resolved.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    }
    return;
  }

  const p = product as ProductRow;
  const effective = getProductPriceCents(p as CatalogProduct, markupPercent, false);
  const local = p.local_price_cents;
  const shouldAlert =
    effective != null && local != null && effective > local;

  if (!shouldAlert) {
    if (existing) {
      const { error: updErr } = await supabaseAdmin
        .from('admin_alerts')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          title: 'VoiceX price above local retail',
          message: 'Pricing no longer exceeds local retail; alert auto-resolved.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (updErr) console.error('[product-price-alerts] Failed to resolve alert:', updErr.message);
    }
    return;
  }

  const payload = buildPayload(p, markupPercent, effective);
  const title = 'VoiceX price above local retail';
  const message =
    'Effective VoiceX price exceeds the configured local store price for this product.';

  if (!existing) {
    const { error: insErr } = await supabaseAdmin.from('admin_alerts').insert({
      alert_type: ALERT_TYPE,
      status: 'new',
      entity_type: 'catalog_product',
      entity_id: productId,
      product_id: productId,
      title,
      message,
      payload,
    });
    if (insErr && !String(insErr.message).includes('duplicate')) {
      console.error('[product-price-alerts] Failed to insert alert:', insErr.message);
    }
    return;
  }

  let nextStatus = existing.status;
  if (existing.status === 'resolved') {
    nextStatus = 'new';
  }

  const { error: updErr } = await supabaseAdmin
    .from('admin_alerts')
    .update({
      status: nextStatus,
      resolved_at: null,
      title,
      message,
      payload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (updErr) console.error('[product-price-alerts] Failed to update alert:', updErr.message);
}

/**
 * After `default_markup_percent` changes, re-evaluate alerts for all products
 * that have a local price or already have this alert row (so stale rows resolve).
 */
export async function resyncAllProductVoicexPriceAboveLocalAlerts(): Promise<void> {
  const ids = new Set<string>();
  const pageSize = 500;

  let offset = 0;
  for (;;) {
    const { data: batch, error } = await supabaseAdmin
      .from('catalog_products')
      .select('id')
      .is('deleted_at', null)
      .not('local_price_cents', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('[product-price-alerts] resync batch (with local price):', error.message);
      break;
    }
    if (!batch?.length) break;
    for (const row of batch) ids.add(row.id as string);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  offset = 0;
  for (;;) {
    const { data: batch, error } = await supabaseAdmin
      .from('admin_alerts')
      .select('product_id')
      .eq('alert_type', ALERT_TYPE)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('[product-price-alerts] resync batch (existing alerts):', error.message);
      break;
    }
    if (!batch?.length) break;
    for (const row of batch) ids.add(row.product_id as string);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  for (const id of ids) {
    await syncProductVoicexPriceAboveLocalAlert(id);
  }
}
