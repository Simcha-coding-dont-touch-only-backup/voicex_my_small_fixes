/**
 * Shared helpers for the subscription IVR handlers (split across several files
 * to stay readable). Follows the Returns convention: handler nodes embed the
 * next node_key directly in the gather/say sessionData; `*` back is handled
 * globally by the gather-result menu stack.
 */
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildGather, buildSay, formatCurrency } from '../../teltech/teltech-builder.js';
import { normalizeVoicexId } from '../../teltech/input-normalizer.js';
import { ivrRuntime } from '../runtime.js';
import {
  getProductDisplayName,
  getProductPriceCents,
  weekLabel,
  TERMS_EXPLANATION_REQUIRED_PLAYS,
  SUBSCRIPTION_WEEKS,
} from '@voicex/shared';
import type { CatalogProduct } from '@voicex/shared';
import {
  getOrCreateSubscription,
  getOrCreateDelivery,
  getDeliveries,
  getDeliveryItems,
  getDefaultMarkupPercent,
  type SubscriptionRow,
  type DeliveryRow,
  type DeliveryItemRow,
} from '../../../lib/subscriptions.js';

export const GATHER_PATH = '/api/ivr/voice/gather';

export { formatCurrency, weekLabel };

export function base(ctx: any): Record<string, string> {
  return { call_sid: ctx.callSid, user_id: ctx.sessionData.user_id };
}

export function gather(
  prompt: string,
  sessionData: Record<string, string>,
  opts?: { numDigits?: number; finishOnKey?: string; timeout?: number; tries?: number },
) {
  return {
    type: 'actions' as const,
    response: buildGather({
      prompt,
      actionPath: GATHER_PATH,
      numDigits: opts?.numDigits,
      finishOnKey: opts?.finishOnKey,
      timeout: opts?.timeout ?? 10,
      tries: opts?.tries,
      sessionData,
    }),
  };
}

export function say(ctx: any, message: string, nodeKey: string, extra?: Record<string, string>) {
  return {
    type: 'actions' as const,
    response: buildSay(message, GATHER_PATH, { ...base(ctx), node_key: nodeKey, ...(extra || {}) }),
  };
}

export function sayToMenu(ctx: any, message: string) {
  return say(ctx, message, 'subscriptions_menu');
}

export function sayToMainMenu(ctx: any, message: string) {
  return say(ctx, message, 'main_menu');
}

/**
 * A "post action" lets the alerts inbox send the caller into the card/address
 * flow and then bounce them to a follow-up node (e.g. retry their failed
 * delivery) once they finish. Stored server-side in call_sessions.state_data so
 * it survives the multi-step entry without threading through query params.
 */
export interface PostAction {
  node: string;
  run_id?: string;
}

export async function setPostAction(callSid: string, payload: PostAction | null): Promise<void> {
  const session = await ivrRuntime.getSession(callSid);
  const stateData = { ...((session?.state_data as Record<string, unknown>) || {}) };
  if (payload === null) delete stateData.sub_post_action;
  else stateData.sub_post_action = payload;
  await ivrRuntime.updateSession(callSid, { state_data: stateData });
}

export async function getPostAction(callSid: string): Promise<PostAction | null> {
  const session = await ivrRuntime.getSession(callSid);
  const pa = (session?.state_data as any)?.sub_post_action;
  return pa && pa.node ? (pa as PostAction) : null;
}

/**
 * Return to the subscription menu, OR to a pending post-action node (consuming
 * it). Used at the success points of the address/card setters.
 */
export async function subscriptionSuccessReturn(ctx: any, message: string) {
  const pa = await getPostAction(ctx.callSid);
  if (pa) {
    await setPostAction(ctx.callSid, null);
    return say(ctx, message, pa.node, pa.run_id ? { run_id: pa.run_id } : undefined);
  }
  return sayToMenu(ctx, message);
}

/** Resolve the subscription for the current caller (creating it if needed). */
export async function getSubscriptionCtx(ctx: any): Promise<SubscriptionRow> {
  return getOrCreateSubscription(ctx.sessionData.user_id);
}

/** Resolve the delivery for a given week of the caller's subscription. */
export async function resolveDelivery(ctx: any, week: number): Promise<{ subscription: SubscriptionRow; delivery: DeliveryRow }> {
  const subscription = await getOrCreateSubscription(ctx.sessionData.user_id);
  const delivery = await getOrCreateDelivery(subscription.id, week);
  return { subscription, delivery };
}

export function weekFromDigit(digits: string | undefined): number | null {
  const n = parseInt(digits || '', 10);
  return n >= 1 && n <= 4 ? n : null;
}

/** "...First Week Delivery, press 1. Second Week Delivery, press 2. ..." */
export function weekSelectPrompt(lead: string): string {
  const parts = SUBSCRIPTION_WEEKS.map((w) => `${weekLabel(w)} Delivery, press ${w}`);
  return `${lead} ${parts.join('. ')}. To return to the main subscription menu, press star.`;
}

export async function isWhitelisted(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('users').select('is_whitelisted').eq('id', userId).maybeSingle();
  return !!data?.is_whitelisted;
}

/** Look up an active, non-deleted catalog product by dialed VoiceX ID. */
export async function lookupActiveProduct(digits: string): Promise<CatalogProduct | null> {
  const lookupId = normalizeVoicexId(digits);
  const { data } = await supabaseAdmin
    .from('catalog_products')
    .select('*')
    .eq('voicex_id', lookupId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle();
  return (data as CatalogProduct) || null;
}

export async function productPriceStr(product: CatalogProduct, userId: string): Promise<string> {
  const markup = await getDefaultMarkupPercent();
  const wl = await isWhitelisted(userId);
  const cents = getProductPriceCents(product, markup, wl);
  return cents != null ? formatCurrency(cents) : 'price unavailable';
}

/** Read the products of a package as a spoken list, e.g. "Tide, quantity 2. ...". */
export function speakPackageList(items: DeliveryItemRow[]): string {
  if (items.length === 0) return '';
  return items
    .map((i) => {
      const name = i.catalog_products ? getProductDisplayName(i.catalog_products) : 'a product';
      return `${name}, quantity ${i.quantity}`;
    })
    .join('. ');
}

/** Find a package item by a dialed VoiceX ID. */
export async function findPackageItemByDialedId(
  deliveryId: string,
  digits: string,
): Promise<DeliveryItemRow | null> {
  const lookupId = normalizeVoicexId(digits);
  const items = await getDeliveryItems(deliveryId);
  return items.find((i) => i.catalog_products?.voicex_id === lookupId) || null;
}

/**
 * Build an indexed spoken list of package items for edit/transfer/remove, e.g.
 * "To edit Tide, press 1 followed by pound." Returns the prompt + the product
 * id CSV (1-indexed) to carry in sessionData.
 */
export function indexedItemListPrompt(
  items: DeliveryItemRow[],
  verb: string,
): { prompt: string; ids: string } {
  const lines = items.map((i, idx) => {
    const name = i.catalog_products ? getProductDisplayName(i.catalog_products) : 'a product';
    return `To ${verb} ${name}, press ${idx + 1} followed by pound`;
  });
  return { prompt: lines.join('. ') + '.', ids: items.map((i) => i.product_id).join(',') };
}

export { getDeliveries, getDeliveryItems, getProductDisplayName };
export type { DeliveryItemRow, DeliveryRow, SubscriptionRow };
