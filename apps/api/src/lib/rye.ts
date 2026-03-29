import CheckoutIntents from 'checkout-intents';
import { config } from '../config.js';

export const ryeClient = new CheckoutIntents({
  apiKey: config.rye.apiKey,
});
