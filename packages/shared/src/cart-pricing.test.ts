import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCartPricingContext,
  priceCartLine,
  sumPricedLines,
  findUnpricedCartLineIds,
  type CartLineInput,
} from './cart-pricing.js';
import type { CatalogProduct } from './types/catalog.js';

const baseProduct: CatalogProduct = {
  id: 'prod-1',
  voicex_id: '0001234',
  amazon_asin: 'B001',
  amazon_url: 'https://amazon.com/dp/B001',
  amazon_name: 'Test Product',
  amazon_description: null,
  amazon_price_cents: 1000,
  voice_name: null,
  voice_description: null,
  custom_price_cents: null,
  local_price_cents: 1200,
  amazon_star_rating: null,
  amazon_ratings_total: null,
  amazon_image_urls: null,
  thumbnail_path: null,
  status: 'active',
  frozen_source: null,
  lifetime_qty_sold: 0,
  created_at: '',
  updated_at: '',
  deleted_at: null,
  deleted_by: null,
};

function makeItem(overrides: Partial<CartLineInput> = {}): CartLineInput {
  return {
    id: 'item-1',
    product_id: 'prod-1',
    voicex_id: '0001234',
    quantity: 2,
    unit_price_cents: 900,
    amazon_price_cents: 900,
    local_price_cents: 1100,
    markup_percent: 0,
    catalog_products: baseProduct,
    ...overrides,
  };
}

describe('priceCartLine', () => {
  it('applies default markup from catalog Amazon price', () => {
    const ctx = buildCartPricingContext({ is_whitelisted: false, custom_markup_percent: null }, 10);
    const priced = priceCartLine(makeItem(), ctx);
    assert.equal(priced.unitPriceCents, 1100);
    assert.equal(priced.amazonPriceCents, 1000);
    assert.equal(priced.markupPercent, 10);
    assert.equal(priced.snapshotUnitPriceCents, 900);
  });

  it('applies custom user markup', () => {
    const ctx = buildCartPricingContext({ is_whitelisted: false, custom_markup_percent: 3 }, 10);
    const priced = priceCartLine(makeItem(), ctx);
    assert.equal(priced.unitPriceCents, 1030);
    assert.equal(priced.markupPercent, 3);
  });

  it('charges base Amazon price for whitelisted users', () => {
    const ctx = buildCartPricingContext({ is_whitelisted: true, custom_markup_percent: null }, 10);
    const priced = priceCartLine(makeItem(), ctx);
    assert.equal(priced.unitPriceCents, 1000);
    assert.equal(priced.markupPercent, 0);
  });

  it('uses catalog custom_price_cents for non-whitelisted users', () => {
    const product = { ...baseProduct, custom_price_cents: 1250 };
    const ctx = buildCartPricingContext({ is_whitelisted: false, custom_markup_percent: 3 }, 10);
    const priced = priceCartLine(makeItem({ catalog_products: product }), ctx);
    assert.equal(priced.unitPriceCents, 1250);
  });

  it('returns null unit price when catalog product is inactive', () => {
    const product = { ...baseProduct, status: 'inactive' as const };
    const ctx = buildCartPricingContext({ is_whitelisted: false, custom_markup_percent: null }, 10);
    const priced = priceCartLine(makeItem({ catalog_products: product }), ctx);
    assert.equal(priced.unitPriceCents, null);
    assert.deepEqual(findUnpricedCartLineIds([priced]), ['item-1']);
  });

  it('returns null unit price when Amazon price is missing', () => {
    const product = { ...baseProduct, amazon_price_cents: null };
    const ctx = buildCartPricingContext({ is_whitelisted: false, custom_markup_percent: null }, 10);
    const priced = priceCartLine(makeItem({ catalog_products: product }), ctx);
    assert.equal(priced.unitPriceCents, null);
  });
});

describe('sumPricedLines', () => {
  it('sums live unit prices by quantity', () => {
    const ctx = buildCartPricingContext({ is_whitelisted: false, custom_markup_percent: 10 }, 10);
    const lines = [priceCartLine(makeItem({ quantity: 2 }), ctx)];
    assert.equal(sumPricedLines(lines), 2200);
  });
});
