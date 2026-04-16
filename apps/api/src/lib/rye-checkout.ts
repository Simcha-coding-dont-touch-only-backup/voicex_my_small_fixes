import { ryeClient } from './rye.js';

export interface RyeBuyer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface RyeCartItem {
  productUrl: string;
  quantity: number;
}

export interface RyeIntentOffer {
  cost?: {
    subtotal?: { amountSubunits: number; currencyCode: string };
    tax?: { amountSubunits: number; currencyCode: string };
    total?: { amountSubunits: number; currencyCode: string };
    shipping?: { amountSubunits: number; currencyCode: string };
    surcharge?: { amountSubunits: number; currencyCode: string };
    discount?: { amountSubunits: number; currencyCode: string } | null;
  };
  shipping?: {
    availableOptions?: Array<{
      id: string;
      cost: { amountSubunits: number; currencyCode: string };
      deliveryEstimate?: { earliest: string; latest: string };
    }>;
  };
}

export interface RyeIntentItem {
  productUrl: string;
  quantity: number;
  status: 'failed' | 'pending' | 'completed';
  failureCode?: string;
}

export interface RyeIntent {
  id: string;
  state: string;
  productUrl?: string;
  offer?: RyeIntentOffer;
  items?: RyeIntentItem[];
  failureReason?: {
    code: string;
    message?: string;
  };
}

export type StockFailureType = 'out_of_stock' | 'insufficient_stock';

export interface StockFailure {
  type: StockFailureType;
  productUrl: string;
  failureCode: string;
  message?: string;
}

export interface IntentResult {
  success: boolean;
  intent: RyeIntent;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  surchareCents: number;
  stockFailures: StockFailure[];
}

function buildBuyer(address: any, phone?: string): RyeBuyer {
  return {
    firstName: 'VoiceX',
    lastName: 'Customer',
    email: 'orders@voicex.com',
    phone: phone || '2125551234',
    address1: address.address1,
    address2: address.address2 || undefined,
    city: address.city,
    province: address.state,
    postalCode: address.zip_code,
    country: address.country || 'US',
  };
}

/**
 * Create a single-product Rye checkout intent and poll until it resolves.
 * Currently only supports one Amazon product per intent.
 * For multi-product carts, only the first Amazon item is used.
 */
export async function createRyeIntent(
  cartItems: any[],
  address: any,
  callerPhone?: string
): Promise<IntentResult> {
  const amazonItems = cartItems.filter((ci) => ci.catalog_products?.amazon_url);

  if (amazonItems.length === 0) {
    throw new Error('No Amazon products in cart');
  }

  if (amazonItems.length > 1) {
    console.warn(`Cart has ${amazonItems.length} Amazon products but only single-product intents are supported. Using first item only.`);
  }

  const firstItem = amazonItems[0];

  const intent = await ryeClient.checkoutIntents.createAndPoll({
    buyer: buildBuyer(address, callerPhone),
    productUrl: firstItem.catalog_products.amazon_url,
    quantity: firstItem.quantity,
  }) as unknown as RyeIntent;

  const stockFailures = parseIntentFailures(intent);

  let shippingCents = 0;
  let taxCents = 0;
  let totalCents = 0;
  let surchareCents = 0;

  if (intent.offer) {
    shippingCents = intent.offer.shipping?.availableOptions?.[0]?.cost?.amountSubunits
      ?? intent.offer.cost?.shipping?.amountSubunits
      ?? 0;
    taxCents = intent.offer.cost?.tax?.amountSubunits ?? 0;
    totalCents = intent.offer.cost?.total?.amountSubunits ?? 0;
    surchareCents = intent.offer.cost?.surcharge?.amountSubunits ?? 0;
  }

  return {
    success: (intent.state === 'completed' || intent.state === 'awaiting_confirmation') && stockFailures.length === 0,
    intent,
    shippingCents,
    taxCents,
    totalCents,
    surchareCents,
    stockFailures,
  };
}

/**
 * Confirm a Rye checkout intent with drawdown (pre-funded balance) payment.
 * VoiceX charges the customer directly via Sola and pays Rye from its balance.
 */
export async function confirmRyeIntent(
  intentId: string
): Promise<RyeIntent> {
  const completed = await ryeClient.checkoutIntents.confirmAndPoll(intentId, {
    paymentMethod: {
      type: 'drawdown',
    },
  } as any) as unknown as RyeIntent;

  return completed;
}

/**
 * Parse stock-related failures from the intent response.
 *
 * Rye returns per-item status in the items[] array:
 *   - status: "failed" with failureCode identifying the issue
 *   - status: "pending" or "completed" for items that are OK
 *
 * Failure codes:
 *   - insufficient_stock: requested qty exceeds available stock
 *   - product_out_of_stock / out_of_stock: product completely unavailable
 */
export function parseIntentFailures(intent: RyeIntent): StockFailure[] {
  const failures: StockFailure[] = [];

  // Primary path: parse per-item failures from items[] array
  if (intent.items && intent.items.length > 0) {
    for (const item of intent.items) {
      if (item.status !== 'failed' || !item.failureCode) continue;

      const codeLower = item.failureCode.toLowerCase();
      let failureType: StockFailureType;

      if (codeLower.includes('out_of_stock') || codeLower === 'product_out_of_stock') {
        failureType = 'out_of_stock';
      } else if (codeLower.includes('insufficient_stock')) {
        failureType = 'insufficient_stock';
      } else {
        // Treat any other item-level failure as insufficient stock
        // so the user gets a chance to adjust qty
        failureType = 'insufficient_stock';
      }

      failures.push({
        type: failureType,
        productUrl: item.productUrl,
        failureCode: item.failureCode,
        message: intent.failureReason?.message,
      });
    }

    return failures;
  }

  // Fallback: no items[] array (older API response or single-product intent).
  // Use the top-level failureReason only.
  if (intent.state !== 'failed' || !intent.failureReason) {
    return failures;
  }

  const code = intent.failureReason.code || '';
  const codeLower = code.toLowerCase();

  const isOutOfStock =
    codeLower.includes('out_of_stock') ||
    codeLower === 'product_out_of_stock';

  const isInsufficientStock = codeLower.includes('insufficient_stock');

  if (isOutOfStock || isInsufficientStock) {
    const failureType: StockFailureType = isOutOfStock ? 'out_of_stock' : 'insufficient_stock';

    // Single-product intent: use the top-level productUrl if available
    if ((intent as any).productUrl) {
      failures.push({
        type: failureType,
        productUrl: (intent as any).productUrl,
        failureCode: code,
        message: intent.failureReason.message,
      });
    }
  }

  return failures;
}

/**
 * Match a stock failure back to a cart item by product URL.
 */
export function findCartItemForFailure(
  failure: StockFailure,
  cartItems: any[]
): any | null {
  return cartItems.find(
    (ci) => ci.catalog_products?.amazon_url === failure.productUrl
  ) ?? null;
}
