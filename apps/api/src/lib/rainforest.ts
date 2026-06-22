import { config } from '../config.js';

const RAINFOREST_URL = 'https://api.rainforestapi.com/request';

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

export class RainforestProductLookupError extends Error {
  status: number;
  /**
   * True when the lookup was aborted because it exceeded the configured
   * per-request timeout. Callers that have a cached fallback (e.g. checkout
   * revalidation) use this to proceed on stale data instead of failing, while
   * still flagging the result so it can be reviewed later.
   */
  timedOut: boolean;
  constructor(message: string, status: number, timedOut = false) {
    super(message);
    this.name = 'RainforestProductLookupError';
    this.status = status;
    this.timedOut = timedOut;
  }
}

interface RainforestPrice {
  value?: number | null;
  currency?: string | null;
}

interface RainforestImage {
  link?: string | null;
}

interface RainforestAvailability {
  type?: string | null;
  raw?: string | null;
}

interface RainforestBuyboxWinner {
  price?: RainforestPrice | null;
  availability?: RainforestAvailability | null;
}

interface RainforestProduct {
  asin?: string | null;
  link?: string | null;
  title?: string | null;
  description?: string | null;
  brand?: string | null;
  rating?: number | null;
  ratings_total?: number | null;
  images?: RainforestImage[] | null;
  buybox_winner?: RainforestBuyboxWinner | null;
}

interface RainforestRequestInfo {
  success?: boolean;
  message?: string;
}

interface RainforestResponse {
  request_info?: RainforestRequestInfo;
  product?: RainforestProduct;
}

function buildUrl(asin: string): string {
  const params = new URLSearchParams({
    api_key: config.rainforest.apiKey,
    type: 'product',
    amazon_domain: 'amazon.com',
    asin,
  });
  return `${RAINFOREST_URL}?${params.toString()}`;
}

function isNotFoundResponse(json: RainforestResponse): boolean {
  if (!json.product) return true;
  const info = json.request_info;
  if (info && info.success === false) {
    const msg = (info.message || '').toLowerCase();
    if (msg.includes('not found') || msg.includes('no product')) return true;
  }
  return false;
}

function mapAvailability(type: string | null | undefined): {
  availability: AmazonProductLookup['availability'];
  isPurchasable: boolean;
} {
  if (!type) return { availability: 'unknown', isPurchasable: false };
  const normalized = type.toLowerCase();
  if (normalized.includes('in_stock') || normalized === 'in stock') {
    return { availability: 'in_stock', isPurchasable: true };
  }
  if (normalized.includes('out')) {
    return { availability: 'out_of_stock', isPurchasable: false };
  }
  return { availability: 'unknown', isPurchasable: false };
}

async function fetchRainforestProduct(asin: string): Promise<RainforestProduct | null> {
  let res: Response;
  // Bound the request so a slow/hung Rainforest call can never hold open an IVR
  // webhook past TelTech's api_timeout. The default lives in config.priceSync.
  const controller = new AbortController();
  const timeoutMs = config.priceSync.lookupTimeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch(buildUrl(asin), { signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new RainforestProductLookupError(
        `Rainforest request timed out after ${timeoutMs}ms`,
        504,
        true,
      );
    }
    throw new RainforestProductLookupError(
      `Rainforest request failed: ${err?.message || 'network error'}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new RainforestProductLookupError(
      'Rainforest API authentication failed. Check your API key.',
      401,
    );
  }

  if (res.status === 429) {
    throw new RainforestProductLookupError(
      'Rainforest API rate limit hit. Try again shortly.',
      429,
    );
  }

  if (res.status === 404) {
    return null;
  }

  if (res.status >= 500) {
    throw new RainforestProductLookupError(
      `Rainforest request failed: HTTP ${res.status}`,
      502,
    );
  }

  if (res.status >= 400) {
    // Other 4xx (e.g. 400, 409, 422) reflect a problem with our request to
    // Rainforest, not a gateway failure. Surface the upstream status so the
    // caller doesn't mislabel it as 502 Bad Gateway.
    throw new RainforestProductLookupError(
      `Rainforest request rejected: HTTP ${res.status}`,
      res.status,
    );
  }

  if (!res.ok) {
    // Unexpected non-2xx that wasn't a 4xx or 5xx (e.g. an unhandled 3xx that
    // fetch surfaced as non-ok). Treat as a gateway-level anomaly.
    throw new RainforestProductLookupError(
      `Rainforest request failed: HTTP ${res.status}`,
      502,
    );
  }

  const json = (await res.json()) as RainforestResponse;
  if (isNotFoundResponse(json)) return null;
  return json.product ?? null;
}

/**
 * Fetch full Amazon product details for the admin "Add Product" flow via the
 * Rainforest Product Data API.
 *
 * Returns null when the ASIN is not present on Amazon. Throws
 * `RainforestProductLookupError` for auth/rate-limit/transport failures so the
 * route can map them to appropriate HTTP statuses.
 */
export async function fetchAmazonProduct(asin: string): Promise<AmazonProductLookup | null> {
  const normalizedAsin = asin.trim().toUpperCase();
  const product = await fetchRainforestProduct(normalizedAsin);
  if (!product) return null;

  const images: AmazonProductImage[] = (product.images || [])
    .filter((img): img is { link: string } => !!img && typeof img.link === 'string')
    .map((img, index) => ({ url: img.link, is_featured: index === 0 }));

  const buybox = product.buybox_winner;
  const priceValue = buybox?.price?.value;
  // Rainforest reports `buybox_winner.price.value` in dollars (e.g. 79.99),
  // not subunits — convert to cents to match our existing schema.
  const priceCents =
    typeof priceValue === 'number' && isFinite(priceValue)
      ? Math.round(priceValue * 100)
      : null;

  const { availability, isPurchasable } = mapAvailability(buybox?.availability?.type);

  return {
    asin: product.asin || normalizedAsin,
    url: product.link || `https://www.amazon.com/dp/${normalizedAsin}`,
    name: product.title ?? null,
    description: product.description ?? null,
    price_cents: priceCents,
    currency: buybox?.price?.currency || 'USD',
    availability,
    is_purchasable: isPurchasable,
    images,
    brand: product.brand ?? null,
    star_rating: product.rating ?? null,
    ratings_total: product.ratings_total ?? null,
  };
}

/**
 * Lightweight reviews-only lookup used by the IVR runtime. Shares the
 * underlying request with `fetchAmazonProduct`. Returns null on any failure
 * so the caller can fall back to cached values silently.
 */
export async function fetchAmazonProductReviews(asin: string): Promise<AmazonProductReviews | null> {
  try {
    const product = await fetchRainforestProduct(asin.trim().toUpperCase());
    if (!product) return null;

    const ratingsTotal = product.ratings_total ?? 0;
    if (!ratingsTotal) return null;

    return {
      rating: product.rating ?? null,
      ratingsTotal,
    };
  } catch (err) {
    console.error('Failed to fetch Amazon reviews from Rainforest:', err);
    return null;
  }
}
