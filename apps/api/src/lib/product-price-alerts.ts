import {
  ADMIN_ALERT_TYPES,
  getProductPriceCents,
  SETTING_KEYS,
  type CatalogProduct,
  type ProductMissingAmazonPricePayload,
  type ProductVoicexPriceAboveLocalPayload,
} from '@voicex/shared';
import { supabaseAdmin } from './supabase.js';

const ALERT_TYPE_PRICE = ADMIN_ALERT_TYPES.PRODUCT_VOICEX_PRICE_ABOVE_LOCAL;
const ALERT_TYPE_MISSING_AMAZON = ADMIN_ALERT_TYPES.PRODUCT_MISSING_AMAZON_PRICE;

type ProductRow = Pick<
  CatalogProduct,
  | 'id'
  | 'status'
  | 'frozen_source'
  | 'voicex_id'
  | 'amazon_asin'
  | 'amazon_name'
  | 'voice_name'
  | 'custom_price_cents'
  | 'amazon_price_cents'
  | 'local_price_cents'
> & { deleted_at: string | null };

type ExistingAlert = { id: string; status: string };

const PRODUCT_SELECT =
  'id, status, frozen_source, deleted_at, voicex_id, amazon_asin, amazon_name, voice_name, custom_price_cents, amazon_price_cents, local_price_cents';

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

function buildPriceAboveLocalPayload(
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

function buildMissingAmazonPayload(product: ProductRow): ProductMissingAmazonPricePayload {
  return {
    voicex_id: product.voicex_id,
    amazon_asin: product.amazon_asin,
    voice_name: product.voice_name,
    amazon_name: product.amazon_name,
    custom_price_cents: product.custom_price_cents,
    local_price_cents: product.local_price_cents,
  };
}

async function loadExistingAlert(
  productId: string,
  alertType: string,
): Promise<ExistingAlert | undefined> {
  const { data: existingRows, error } = await supabaseAdmin
    .from('admin_alerts')
    .select('id, status')
    .eq('product_id', productId)
    .eq('alert_type', alertType)
    .limit(1);

  if (error) {
    console.error('[product-price-alerts] Failed to load existing alert:', error.message);
    return undefined;
  }

  return existingRows?.[0] as ExistingAlert | undefined;
}

async function resolveAlert(
  existing: ExistingAlert | undefined,
  title: string,
  message: string,
): Promise<void> {
  if (!existing) return;
  const { error: updErr } = await supabaseAdmin
    .from('admin_alerts')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      title,
      message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);
  if (updErr) console.error('[product-price-alerts] Failed to resolve alert:', updErr.message);
}

async function upsertAlert(
  productId: string,
  alertType: string,
  existing: ExistingAlert | undefined,
  title: string,
  message: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!existing) {
    const { error: insErr } = await supabaseAdmin.from('admin_alerts').insert({
      alert_type: alertType,
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

type FreezeReason = 'price_above_local' | 'missing_amazon_price' | 'both';

function freezeReasonFromFlags(priceAboveLocal: boolean, missingAmazon: boolean): FreezeReason {
  if (priceAboveLocal && missingAmazon) return 'both';
  if (missingAmazon) return 'missing_amazon_price';
  return 'price_above_local';
}

async function insertSystemAudit(
  action: 'auto_freeze_product' | 'auto_unfreeze_product',
  productId: string,
  changes: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: null,
    action,
    entity_type: 'catalog_product',
    entity_id: productId,
    changes,
  });
  if (error) {
    console.error(`[product-price-alerts] Failed to write audit (${action}):`, error.message);
  }
}

async function applyAutoFreezeState(
  productId: string,
  product: ProductRow,
  shouldFreeze: boolean,
  priceAboveLocal: boolean,
  missingAmazon: boolean,
): Promise<void> {
  if (shouldFreeze) {
    if (product.status !== 'active') return;

    const reason = freezeReasonFromFlags(priceAboveLocal, missingAmazon);
    const { error } = await supabaseAdmin
      .from('catalog_products')
      .update({
        status: 'frozen',
        frozen_source: 'auto',
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId);

    if (error) {
      console.error('[product-price-alerts] Failed to auto-freeze product:', error.message);
      return;
    }

    await insertSystemAudit('auto_freeze_product', productId, {
      reason,
      previous_status: product.status,
      new_status: 'frozen',
      product_id: productId,
    });
    return;
  }

  if (product.status !== 'frozen' || product.frozen_source !== 'auto') return;

  const { error } = await supabaseAdmin
    .from('catalog_products')
    .update({
      status: 'active',
      frozen_source: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', productId);

  if (error) {
    console.error('[product-price-alerts] Failed to auto-unfreeze product:', error.message);
    return;
  }

  await insertSystemAudit('auto_unfreeze_product', productId, {
    previous_status: 'frozen',
    new_status: 'active',
    product_id: productId,
  });
}

async function syncPriceAboveLocalAlert(
  productId: string,
  product: ProductRow,
  markupPercent: number,
  shouldFreeze: boolean,
): Promise<void> {
  const title = 'VoiceX price above local retail';
  const existing = await loadExistingAlert(productId, ALERT_TYPE_PRICE);
  const effective = getProductPriceCents(product as CatalogProduct, markupPercent, false);
  const local = product.local_price_cents;
  const priceAboveLocal = effective != null && local != null && effective > local;

  if (!priceAboveLocal) {
    await resolveAlert(
      existing,
      title,
      'Pricing no longer exceeds local retail; alert auto-resolved.',
    );
    return;
  }

  const autoFrozenNote = shouldFreeze ? ' Product was auto-frozen.' : '';
  const message =
    `Effective VoiceX price exceeds the configured local store price for this product.${autoFrozenNote}`;
  const payload = buildPriceAboveLocalPayload(product, markupPercent, effective);
  await upsertAlert(productId, ALERT_TYPE_PRICE, existing, title, message, payload as unknown as Record<string, unknown>);
}

async function syncMissingAmazonAlert(
  productId: string,
  product: ProductRow,
  shouldFreeze: boolean,
): Promise<void> {
  const title = 'Amazon price not set';
  const existing = await loadExistingAlert(productId, ALERT_TYPE_MISSING_AMAZON);
  const missingAmazon = product.amazon_price_cents == null;

  if (!missingAmazon) {
    await resolveAlert(
      existing,
      title,
      'Amazon price is now set; alert auto-resolved.',
    );
    return;
  }

  const autoFrozenNote = shouldFreeze ? ' Product was auto-frozen.' : '';
  const message = `This product has no Amazon price.${autoFrozenNote}`;
  const payload = buildMissingAmazonPayload(product);
  await upsertAlert(productId, ALERT_TYPE_MISSING_AMAZON, existing, title, message, payload as unknown as Record<string, unknown>);
}

/**
 * Syncs catalog product alerts (price above local, missing Amazon price) and auto-freeze state.
 */
export async function syncProductCatalogAlerts(productId: string): Promise<void> {
  const markupPercent = await getDefaultMarkupPercent();

  const { data: product, error: productError } = await supabaseAdmin
    .from('catalog_products')
    .select(PRODUCT_SELECT)
    .eq('id', productId)
    .maybeSingle();

  if (productError) {
    console.error('[product-price-alerts] Failed to load product:', productError.message);
    return;
  }

  if (!product || product.deleted_at != null) {
    const [priceAlert, missingAlert] = await Promise.all([
      loadExistingAlert(productId, ALERT_TYPE_PRICE),
      loadExistingAlert(productId, ALERT_TYPE_MISSING_AMAZON),
    ]);
    await resolveAlert(
      priceAlert,
      'VoiceX price above local retail',
      'Product was removed or trashed; alert auto-resolved.',
    );
    await resolveAlert(
      missingAlert,
      'Amazon price not set',
      'Product was removed or trashed; alert auto-resolved.',
    );
    return;
  }

  const p = product as ProductRow;
  const effective = getProductPriceCents(p as CatalogProduct, markupPercent, false);
  const local = p.local_price_cents;
  const priceAboveLocal = effective != null && local != null && effective > local;
  const missingAmazon = p.amazon_price_cents == null;
  const shouldFreeze = priceAboveLocal || missingAmazon;

  await syncPriceAboveLocalAlert(productId, p, markupPercent, shouldFreeze);
  await syncMissingAmazonAlert(productId, p, shouldFreeze);
  await applyAutoFreezeState(productId, p, shouldFreeze, priceAboveLocal, missingAmazon);
}

/** @deprecated Use syncProductCatalogAlerts */
export const syncProductVoicexPriceAboveLocalAlert = syncProductCatalogAlerts;

/**
 * After `default_markup_percent` changes, re-evaluate alerts for affected products.
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
      .from('catalog_products')
      .select('id')
      .is('deleted_at', null)
      .is('amazon_price_cents', null)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('[product-price-alerts] resync batch (missing amazon):', error.message);
      break;
    }
    if (!batch?.length) break;
    for (const row of batch) ids.add(row.id as string);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  for (const alertType of [ALERT_TYPE_PRICE, ALERT_TYPE_MISSING_AMAZON]) {
    offset = 0;
    for (;;) {
      const { data: batch, error } = await supabaseAdmin
        .from('admin_alerts')
        .select('product_id')
        .eq('alert_type', alertType)
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
  }

  for (const id of ids) {
    await syncProductCatalogAlerts(id);
  }
}
