import { supabaseAdmin } from './supabase.js';

/**
 * Structured event types for the checkout flow. Adding a new value:
 *   1. Add it here.
 *   2. Make sure the admin UI's friendly-label map covers it
 *      (apps/admin-web/src/pages/LogsPage.tsx).
 *
 * Naming convention: `<surface>_<action>[_succeeded|_failed]`.
 */
export type CheckoutEventType =
  // Flow entry / navigation
  | 'checkout_entered'              // user reached checkout (address or payment selection)
  | 'address_attempted'             // each Google address validation call (per attempt/retry/re-enter)
  | 'address_selected'              // saved address picked or new one created
  | 'payment_method_selected'       // saved card picked or new one collected
  // Rye intent creation
  | 'rye_intent_created'            // intent reached awaiting_confirmation
  | 'rye_intent_failed'             // intent reached failed (any non-stock reason)
  | 'rye_intent_unavailable'        // product_not_found surfaced; auto-recovery starting
  | 'rye_intent_stock_issue'        // out_of_stock or insufficient_stock per item
  // Recovery flows
  | 'unavailable_item_removed'      // we deleted a product_not_found item from cart
  | 'stock_item_removed'            // user (or retry-cap) removed an out-of-stock item
  | 'stock_item_qty_updated'        // user reduced qty after insufficient_stock
  // Payment + order placement
  | 'sola_auth_succeeded'           // Sola auth-only hold succeeded
  | 'sola_auth_failed'              // Sola auth-only hold failed (decline, network, etc.)
  | 'order_persisted'               // orders + order_items rows created in DB
  | 'rye_confirm_succeeded'         // Rye drawdown confirm reached completed
  | 'rye_confirm_failed'            // Rye drawdown confirm reached failed
  | 'sola_capture_succeeded'        // Sola capture succeeded (real charge)
  | 'sola_capture_failed'           // Sola capture failed after Rye succeeded (manual review)
  | 'sola_void_release'             // Sola hold released after Rye failure
  | 'order_completed'               // order.status set to completed
  | 'order_failed'                  // order.status set to failed
  // Cancellation / abandonment
  | 'checkout_cancelled';           // user pressed cancel at confirmation prompt

export type CheckoutEventSeverity = 'info' | 'warn' | 'error';

export interface CheckoutEventInput {
  callSid: string;
  userId?: string | null;
  orderId?: string | null;
  eventType: CheckoutEventType;
  severity?: CheckoutEventSeverity;
  details?: Record<string, unknown>;
}

/**
 * Persist a checkout event. Failures here are swallowed (logged to console)
 * because we never want logging to break the actual checkout flow.
 */
export async function logCheckoutEvent(event: CheckoutEventInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('checkout_events').insert({
      call_sid: event.callSid,
      user_id: event.userId ?? null,
      order_id: event.orderId ?? null,
      event_type: event.eventType,
      severity: event.severity ?? 'info',
      details: event.details ?? {},
    });
    if (error) {
      console.error('[checkout-logger] insert failed', { event: event.eventType, error });
    }
  } catch (err) {
    console.error('[checkout-logger] insert threw', { event: event.eventType, err });
  }
}
