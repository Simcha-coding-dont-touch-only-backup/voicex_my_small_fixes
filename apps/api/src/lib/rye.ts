import CheckoutIntents from 'checkout-intents';
import { config } from '../config.js';

// Kept solely for the checkout/fulfillment paths in `rye-checkout.ts`. All
// product-lookup code has moved to `rainforest.ts`.
export const ryeClient = new CheckoutIntents({
  apiKey: config.rye.apiKey,
});
