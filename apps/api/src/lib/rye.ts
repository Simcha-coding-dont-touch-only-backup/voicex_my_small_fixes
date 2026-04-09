import CheckoutIntents from 'checkout-intents';
import { config } from '../config.js';

export const ryeClient = new CheckoutIntents({
  apiKey: config.rye.apiKey,
});

const RYE_GRAPHQL_URL = 'https://graphql.api.rye.com/v1/query';

export interface AmazonProductReviews {
  rating: number;
  ratingsTotal: number;
}

interface RyeGraphQLProduct {
  ratingsTotal: number;
  reviewsTotal: number;
  specifications: Array<{ name: string; value: string }>;
}

function parseStarRating(specifications: Array<{ name: string; value: string }>): number | null {
  const reviewSpec = specifications.find(s => s.name === 'Customer Reviews');
  if (!reviewSpec) return null;
  const match = reviewSpec.value.match(/([\d.]+)\s+out of\s+5/);
  return match ? parseFloat(match[1]) : null;
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
    const res = await fetch(RYE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${config.rye.apiKey}`,
        'Rye-Shopper-IP': '127.0.0.1',
      },
      body: JSON.stringify({ query, variables: { id: asin } }),
    });

    if (!res.ok) {
      console.error(`Rye GraphQL error: ${res.status} ${res.statusText}`);
      return null;
    }

    const json = await res.json() as {
      data?: { productByID?: RyeGraphQLProduct };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      console.error('Rye GraphQL errors:', json.errors);
      return null;
    }

    const product = json.data?.productByID;
    if (!product) return null;

    const starRating = parseStarRating(product.specifications || []);
    const totalReviews = product.ratingsTotal || product.reviewsTotal || 0;

    if (!starRating && !totalReviews) return null;

    return {
      rating: starRating || 0,
      ratingsTotal: totalReviews,
    };
  } catch (err) {
    console.error('Failed to fetch Amazon reviews from Rye:', err);
    return null;
  }
}
