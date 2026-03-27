import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';
import { handlePinEntry } from '../../ivr/flows/pin-flow.js';
import { handleRegistration } from '../../ivr/flows/registration-flow.js';
import { handleMainMenu } from '../../ivr/flows/main-menu-flow.js';
import { handleCatalogFlow } from '../../ivr/flows/catalog-flow.js';
import { handleCartFlow } from '../../ivr/flows/cart-flow.js';
import { handleCheckoutFlow } from '../../ivr/flows/checkout-flow.js';
import { handleOrdersFlow } from '../../ivr/flows/orders-flow.js';

const STEP_HANDLERS: Record<string, (req: Request, res: Response) => Promise<void>> = {
  pin_entry: handlePinEntry,
  pin_confirm: handlePinEntry,
  register_name: handleRegistration,
  register_name_confirm: handleRegistration,
  register_pin: handleRegistration,
  register_pin_confirm: handleRegistration,
  main_menu: handleMainMenu,
  catalog_input: handleCatalogFlow,
  catalog_action: handleCatalogFlow,
  catalog_qty: handleCatalogFlow,
  catalog_qty_confirm: handleCatalogFlow,
  catalog_after_add: handleCatalogFlow,
  cart_menu: handleCartFlow,
  cart_list: handleCartFlow,
  cart_change_id: handleCartFlow,
  cart_change_qty: handleCartFlow,
  cart_change_confirm: handleCartFlow,
  cart_remove_id: handleCartFlow,
  cart_remove_confirm: handleCartFlow,
  checkout_address_choice: handleCheckoutFlow,
  checkout_address_line1: handleCheckoutFlow,
  checkout_address_line2: handleCheckoutFlow,
  checkout_address_city: handleCheckoutFlow,
  checkout_address_state: handleCheckoutFlow,
  checkout_address_zip: handleCheckoutFlow,
  checkout_address_confirm: handleCheckoutFlow,
  checkout_payment_choice: handleCheckoutFlow,
  checkout_summary: handleCheckoutFlow,
  checkout_confirm: handleCheckoutFlow,
  orders_list: handleOrdersFlow,
  orders_detail: handleOrdersFlow,
};

export async function handleGatherResult(req: Request, res: Response) {
  const step = req.query.step as string || req.body.step;
  const handler = STEP_HANDLERS[step];

  if (!handler) {
    console.error(`Unknown IVR step: ${step}`);
    const { buildHangup } = await import('../twiml-builder.js');
    res.type('text/xml').send(
      buildHangup('An error occurred. Please call back.')
    );
    return;
  }

  try {
    await handler(req, res);
  } catch (error) {
    console.error(`Error in step ${step}:`, error);
    const { buildHangup } = await import('../twiml-builder.js');
    res.type('text/xml').send(
      buildHangup('We encountered an error. Please try again later.')
    );
  }
}
