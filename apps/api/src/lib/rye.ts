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

interface RyeGraphQLProduct {
  ratingsTotal: number;
  reviewsTotal: number;
  specifications: Array<{ name: string; value: string }>;
}

function getGraphQLHeaders(): Record<string, string> {
  const encoded = Buffer.from(`${config.rye.apiKey}:`).toString('base64');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${encoded}`,
    'Rye-Shopper-IP': '127.0.0.1',
  };
}

function parseStarRating(specifications: Array<{ name: string; value: string }>): number | null {
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

export async function fetchAmazonProductReviews(asin: string): Promise<AmazonProductReviews | null> {
  const query = `
    query GetAmazonReviews($id: ID!) {
      productByID(input: { id: $id, marketplace: AMAZON }) {
        ... on AmazonProduct {
          ratingsTotal
          reviewsTotal
          specifications { name value }
        }
      }
    }
  `;

  try {
    let res = await fetch(RYE_GRAPHQL_URL, {
      method: 'POST',
      headers: getGraphQLHeaders(),
      body: JSON.stringify({ query, variables: { id: asin } }),
    });

    if (!res.ok) {
      console.error(`Rye GraphQL error: ${res.status} ${res.statusText}`);
      return null;
    }

    let json = await res.json() as {
      data?: { productByID?: RyeGraphQLProduct };
      errors?: Array<{ message: string }>;
    };

    // If product not found, request it and retry once
    if (!json.data?.productByID && !json.errors?.length) {
      await ensureProductRequested(`https://www.amazon.com/dp/${asin}`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      res = await fetch(RYE_GRAPHQL_URL, {
        method: 'POST',
        headers: getGraphQLHeaders(),
        body: JSON.stringify({ query, variables: { id: asin } }),
      });

      if (!res.ok) return null;
      json = await res.json() as typeof json;
    }

    if (json.errors?.length) {
      console.error('Rye GraphQL errors:', json.errors);
      return null;
    }

    const product = json.data?.productByID;
    if (!product) return null;

    const starRating = parseStarRating(product.specifications || []);
    const totalReviews = product.ratingsTotal || product.reviewsTotal || 0;

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
