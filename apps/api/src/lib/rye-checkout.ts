import { ryeClient } from './rye.js';

// The Rye SDK (checkout-intents@0.23.0) types don't yet include the
// multi-item items[] create param or the items[] field on the response.
// The REST API supports it (confirmed with Rye support). We use type
// assertions to bypass the SDK's type limitations until they update.

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

export interface RyeIntent {
  id: string;
  state: string;
  offer?: RyeIntentOffer;
  items?: Array<{
    productUrl: string;
    quantity: number;
  }>;
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

function buildBuyer(address: any): RyeBuyer {
  return {
    firstName: 'VoiceX',
    lastName: 'Customer',
    email: 'orders@voicex.com',
    phone: '0000000000',
    address1: address.address1,
    address2: address.address2 || undefined,
    city: address.city,
    province: address.state,
    postalCode: address.zip_code,
    country: address.country || 'US',
  };
}

/**
 * Create a multi-item Rye checkout intent and poll until it resolves.
 * Uses the new items[] API to send all cart products in a single intent.
 */
export async function createRyeIntent(
  cartItems: any[],
  address: any
): Promise<IntentResult> {
  const amazonItems = cartItems.filter((ci) => ci.catalog_products?.amazon_url);

  if (amazonItems.length === 0) {
    throw new Error('No Amazon products in cart');
  }

  const items: RyeCartItem[] = amazonItems.map((ci) => ({
    productUrl: ci.catalog_products.amazon_url,
    quantity: ci.quantity,
  }));

  // SDK types require productUrl+quantity at top level but the API now
  // accepts an items[] array for multi-product intents. Cast to bypass.
  const createParams = {
    buyer: buildBuyer(address),
    items,
  } as any;

  const intent = await ryeClient.checkoutIntents.createAndPoll(createParams) as unknown as RyeIntent;

  const stockFailures = parseIntentFailures(intent, amazonItems);

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
    success: intent.state === 'completed' && stockFailures.length === 0,
    intent,
    shippingCents,
    taxCents,
    totalCents,
    surchareCents,
    stockFailures,
  };
}

/**
 * Confirm a Rye checkout intent with payment.
 */
export async function confirmRyeIntent(
  intentId: string,
  paymentMethod: any
): Promise<RyeIntent> {
  const completed = await ryeClient.checkoutIntents.confirmAndPoll(intentId, {
    paymentMethod: {
      stripeToken: paymentMethod.stripe_token,
      type: 'stripe_token',
    },
  }) as unknown as RyeIntent;

  return completed;
}

/**
 * Parse stock-related failures from an intent response.
 *
 * Rye can return two stock failure codes:
 *   - product_out_of_stock / out_of_stock: product is completely unavailable
 *   - insufficient_stock: requested qty exceeds available stock
 *
 * Defensive approach: if the intent failed for any stock-related reason,
 * we assume the whole intent failed (Rye doesn't support partial success
 * on multi-item intents). We map the failure back to the cart items.
 */
export function parseIntentFailures(
  intent: RyeIntent,
  cartItems: any[]
): StockFailure[] {
  const failures: StockFailure[] = [];

  if (intent.state !== 'failed' || !intent.failureReason) {
    return failures;
  }

  const code = intent.failureReason.code || '';
  const message = intent.failureReason.message || '';
  const codeLower = code.toLowerCase();

  const isOutOfStock =
    codeLower.includes('out_of_stock') ||
    codeLower.includes('product_out_of_stock');

  const isInsufficientStock = codeLower.includes('insufficient_stock');

  if (isOutOfStock || isInsufficientStock) {
    const failureType: StockFailureType = isOutOfStock ? 'out_of_stock' : 'insufficient_stock';

    // Try to identify which product(s) caused the failure from the error message.
    // If we can't, mark all items as potentially affected.
    const affectedUrls = extractAffectedProductUrls(message, cartItems);

    if (affectedUrls.length > 0) {
      for (const url of affectedUrls) {
        failures.push({ type: failureType, productUrl: url, failureCode: code, message });
      }
    } else {
      for (const ci of cartItems) {
        if (ci.catalog_products?.amazon_url) {
          failures.push({
            type: failureType,
            productUrl: ci.catalog_products.amazon_url,
            failureCode: code,
            message,
          });
        }
      }
    }
  }

  return failures;
}

/**
 * Attempt to match product URLs or ASINs mentioned in the error message
 * back to specific cart items. Returns empty array if we can't determine
 * which product is affected (caller should treat all items as suspect).
 */
function extractAffectedProductUrls(message: string, cartItems: any[]): string[] {
  if (!message) return [];

  const urls: string[] = [];
  for (const ci of cartItems) {
    const product = ci.catalog_products;
    if (!product?.amazon_url) continue;

    const asin = product.amazon_asin || '';
    const url = product.amazon_url;

    if (
      (asin && message.includes(asin)) ||
      message.includes(url)
    ) {
      urls.push(url);
    }
  }

  return urls;
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
