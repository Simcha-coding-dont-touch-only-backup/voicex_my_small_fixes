import CheckoutIntents from 'checkout-intents';
import { config } from '../config.js';

export const ryeClient = new CheckoutIntents({
  apiKey: config.rye.apiKey,
});

const RYE_GRAPHQL_URL = 'https://graphql.api.rye.com/v1/query';

export interface AmazonProductReviews {
  rating: number | null;
  ratingsTotal: number;
}

export interface AmazonProductImage {
  url: string;
  is_featured: boolean;
}

export interface AmazonProductLookup {
  asin: string;
  url: string;
  name: string | null;
  description: string | null;
  price_cents: number | null;
  currency: string;
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
  is_purchasable: boolean;
  images: AmazonProductImage[];
  brand: string | null;
  star_rating: number | null;
  ratings_total: number | null;
}

interface RyeGraphQLAmazonProduct {
  ASIN?: string | null;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  vendor?: string | null;
  isAvailable?: boolean | null;
  ratingsTotal?: number | null;
  reviewsTotal?: number | null;
  // Rye GraphQL `Price.value` is the integer amount in subunits (cents for USD).
  // See https://docs.rye.com/get-started/intro-to-graphql — example: `{ value: 798, displayValue: "$7.98" }`.
  price?: { value?: number | null; currency?: string | null } | null;
  images?: Array<{ url?: string | null }> | null;
  specifications?: Array<{ name: string; value: string }> | null;
}

export class RyeProductLookupError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RyeProductLookupError';
    this.status = status;
  }
}

function getGraphQLHeaders(): Record<string, string> {
  const encoded = Buffer.from(`${config.rye.apiKey}:`).toString('base64');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${encoded}`,
    'Rye-Shopper-IP': '127.0.0.1',
  };
}

function parseStarRating(specifications: Array<{ name: string; value: string }> | null | undefined): number | null {
  if (!specifications) return null;
  const reviewSpec = specifications.find(s => s.name === 'Customer Reviews');
  if (!reviewSpec) return null;
  const match = reviewSpec.value.match(/([\d.]+)\s+out of\s+5/);
  return match ? parseFloat(match[1]) : null;
}

async function ensureProductRequested(amazonUrl: string): Promise<void> {
  const mutation = `
    mutation RequestProduct($url: URL!) {
      requestAmazonProductByURL(input: { url: $url }) {
        productId
      }
    }
  `;

  try {
    await fetch(RYE_GRAPHQL_URL, {
      method: 'POST',
      headers: getGraphQLHeaders(),
      body: JSON.stringify({ query: mutation, variables: { url: amazonUrl } }),
    });
  } catch {
    // Best-effort; the subsequent query will handle the failure
  }
}

const PRODUCT_QUERY = `
  query GetAmazonProduct($id: ID!) {
    productByID(input: { id: $id, marketplace: AMAZON }) {
      ... on AmazonProduct {
        ASIN
        url
        title
        description
        vendor
        isAvailable
        ratingsTotal
        reviewsTotal
        price { value currency }
        images { url }
        specifications { name value }
      }
    }
  }
`;

interface FetchProductOptions {
  /** When true, missing products trigger a one-time request + retry. Default: true. */
  requestIfMissing?: boolean;
}

async function runProductQuery(asin: string): Promise<{
  product: RyeGraphQLAmazonProduct | null;
  status: number;
  errors?: Array<{ message: string }>;
}> {
  const res = await fetch(RYE_GRAPHQL_URL, {
    method: 'POST',
    headers: getGraphQLHeaders(),
    body: JSON.stringify({ query: PRODUCT_QUERY, variables: { id: asin } }),
  });

  if (!res.ok) {
    return { product: null, status: res.status };
  }

  const json = await res.json() as {
    data?: { productByID?: RyeGraphQLAmazonProduct };
    errors?: Array<{ message: string }>;
  };

  return {
    product: json.data?.productByID ?? null,
    status: res.status,
    errors: json.errors,
  };
}

/**
 * Fetch raw Amazon product data from Rye's GraphQL API.
 *
 * Rye lazily ingests products: a brand-new ASIN returns null on the first
 * call, so we fire `requestAmazonProductByURL` and retry once after a short
 * delay. Returns null if the product still isn't available after the retry.
 *
 * Throws `RyeProductLookupError` for non-recoverable failures (auth, network).
 */
async function fetchRawAmazonProduct(
  asin: string,
  opts: FetchProductOptions = {}
): Promise<RyeGraphQLAmazonProduct | null> {
  const { requestIfMissing = true } = opts;

  let result = await runProductQuery(asin);
  assertOkStatus(result.status);

  if (result.errors?.length) {
    console.error('Rye GraphQL errors:', result.errors);
    return null;
  }

  if (!result.product && requestIfMissing) {
    await ensureProductRequested(`https://www.amazon.com/dp/${asin}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    result = await runProductQuery(asin);
    assertOkStatus(result.status);

    if (result.errors?.length) {
      console.error('Rye GraphQL errors (after request):', result.errors);
      return null;
    }
  }

  return result.product ?? null;
}

function assertOkStatus(status: number): void {
  if (!status || status >= 500) {
    throw new RyeProductLookupError(
      `Rye GraphQL request failed: HTTP ${status}`,
      502,
    );
  }

  if (status === 401 || status === 403) {
    throw new RyeProductLookupError(
      'Rye API authentication failed. Check your API key.',
      401,
    );
  }
}

/**
 * Fetch full Amazon product details for the admin "Add Product" flow.
 *
 * Replaces the legacy `ryeClient.products.lookup({ url })` REST call (the Rye
 * Product Data REST API was decommissioned). Backed by the same GraphQL
 * endpoint already used for IVR review lookups.
 *
 * Returns null if the product cannot be found even after a retry; throws
 * `RyeProductLookupError` for auth/transport failures so the route can map
 * them to appropriate HTTP statuses.
 */
export async function fetchAmazonProduct(asin: string): Promise<AmazonProductLookup | null> {
  const normalizedAsin = asin.trim().toUpperCase();
  const product = await fetchRawAmazonProduct(normalizedAsin);
  if (!product) return null;

  const images: AmazonProductImage[] = (product.images || [])
    .filter((img): img is { url: string } => !!img && typeof img.url === 'string')
    .map((img, index) => ({ url: img.url, is_featured: index === 0 }));

  const isAvailable = product.isAvailable === true;
  const availability: AmazonProductLookup['availability'] =
    product.isAvailable == null ? 'unknown' : isAvailable ? 'in_stock' : 'out_of_stock';

  const starRating = parseStarRating(product.specifications);
  const ratingsTotal = product.ratingsTotal ?? product.reviewsTotal ?? null;

  return {
    asin: product.ASIN || normalizedAsin,
    url: product.url || `https://www.amazon.com/dp/${normalizedAsin}`,
    name: product.title ?? null,
    description: product.description ?? null,
    // `price.value` is already in subunits (cents) per Rye's GraphQL schema.
    price_cents: product.price?.value ?? null,
    currency: product.price?.currency || 'USD',
    availability,
    is_purchasable: isAvailable,
    images,
    brand: product.vendor ?? null,
    star_rating: starRating,
    ratings_total: ratingsTotal,
  };
}

/**
 * Lightweight reviews-only lookup used by the IVR runtime. Shares the
 * underlying query with `fetchAmazonProduct` so we only maintain one path.
 */
export async function fetchAmazonProductReviews(asin: string): Promise<AmazonProductReviews | null> {
  try {
    const product = await fetchRawAmazonProduct(asin.trim().toUpperCase());
    if (!product) return null;

    const starRating = parseStarRating(product.specifications);
    const totalReviews = product.ratingsTotal ?? product.reviewsTotal ?? 0;

    if (!totalReviews) return null;

    return {
      rating: starRating,
      ratingsTotal: totalReviews,
    };
  } catch (err) {
    console.error('Failed to fetch Amazon reviews from Rye:', err);
    return null;
  }
}
