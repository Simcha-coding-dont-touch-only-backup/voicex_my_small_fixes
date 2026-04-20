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

export type StockFailureType = 'out_of_stock' | 'insufficient_stock' | 'unavailable';

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
 * Create a multi-item Rye checkout intent and poll until it resolves.
 *
 * Sends every Amazon product in the cart as a single intent via the items[]
 * payload (verified working against Rye production -- the SDK 0.23.0 types
 * don't surface items[] yet, so we cast through `any`). Rye returns one
 * aggregated offer (subtotal/tax/total/shipping) covering the whole cart,
 * which we then confirm with a single drawdown payment.
 *
 * Failure modes the caller should handle via the returned StockFailure[]:
 *   - 'out_of_stock' / 'insufficient_stock': per-item stock issue (items[].failureCode)
 *   - 'unavailable':                          product_not_found at the intent level
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

  const items: RyeCartItem[] = amazonItems.map((ci) => ({
    productUrl: ci.catalog_products.amazon_url,
    quantity: ci.quantity,
  }));

  const intent = await ryeClient.checkoutIntents.createAndPoll({
    buyer: buildBuyer(address, callerPhone),
    items,
  } as any) as unknown as RyeIntent;

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
 * Parse failures from the intent response into per-item entries the IVR can act on.
 *
 * Two distinct failure shapes show up from Rye:
 *
 *   1. Per-item stock failure: state="failed", items[i].status="failed" with
 *      a failureCode like "product_out_of_stock" or "insufficient_stock".
 *      Other items in the cart stay status="pending" and are still good --
 *      we walk the user through resolving each failed item, then retry with
 *      the cleaned cart.
 *
 *   2. Catalog miss: state="failed", failureReason.code="product_not_found".
 *      Rye stops short of evaluating per-item stock in this case, so items[]
 *      shows everything as "pending" and the failed product ID is only present
 *      in failureReason.message (top-level productUrl just echoes items[0],
 *      not the bad item). We extract the ASIN from the message and match it
 *      back to a cart item by amazon_url.
 *
 * Both shapes return the same StockFailure[] structure so the caller can
 * dispatch on `type` ('out_of_stock' | 'insufficient_stock' | 'unavailable').
 */
export function parseIntentFailures(intent: RyeIntent): StockFailure[] {
  const failures: StockFailure[] = [];

  // Shape 1: per-item failures inside items[]
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
        // Any other per-item failure -- treat as insufficient stock so the
        // user gets a chance to lower the qty before we drop the item.
        failureType = 'insufficient_stock';
      }

      // NOTE: Rye does not provide a per-item human-readable message --
      // failureReason.message is an intent-level summary like
      // "1 of 2 items unavailable" and is not relevant to any single item,
      // so we deliberately omit `message` here. Use `failureCode` for the
      // structured signal and look up the product name from the cart for
      // the user-facing prompt.
      failures.push({
        type: failureType,
        productUrl: item.productUrl,
        failureCode: item.failureCode,
      });
    }

    if (failures.length > 0) return failures;
  }

  // Shape 2: top-level catalog miss (product_not_found)
  if (intent.state === 'failed' && intent.failureReason?.code === 'product_not_found') {
    const message = intent.failureReason.message || '';
    // Message format from Rye:
    //   "Product with product id <ASIN> not found on Amazon"
    const asinMatch = message.match(/product id\s+(\S+?)\s+not found/i);
    const badAsin = asinMatch?.[1];

    // Match back to a cart item via the items[] array (productUrl contains the ASIN).
    const failedItemUrl = badAsin
      ? intent.items?.find((it) => it.productUrl?.includes(badAsin))?.productUrl
      : undefined;

    if (failedItemUrl) {
      failures.push({
        type: 'unavailable',
        productUrl: failedItemUrl,
        failureCode: 'product_not_found',
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
