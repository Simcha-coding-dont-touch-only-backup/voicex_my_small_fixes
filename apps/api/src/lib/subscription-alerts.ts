/**
 * Helpers to create/resolve the subscription admin alerts (Delivery Issues and
 * Failed Deliveries) in the shared `admin_alerts` table.
 *
 * Delivery Issue alerts are admin-only. Failed Delivery alerts additionally show
 * up in the caller's IVR alert inbox (until heard) and carry an `ivr_message`.
 */
import { supabaseAdmin } from './supabase.js';
import {
  ADMIN_ALERT_TYPES,
  SUBSCRIPTION_ALERT_TYPES,
  subscriptionAlertIssueLabel,
  weekLabel,
} from '@voicex/shared';
import type { SubscriptionAlertPayload } from '@voicex/shared';

const SUBSCRIPTION_DELIVERY_ENTITY = 'subscription_delivery';

export interface SubscriptionAlertInput {
  userId: string;
  deliveryId: string;
  weekNumber: number;
  runId?: string | null;
  cycleDate?: string | null;
  issueType: string;
  title?: string;
  /** Internal admin note. */
  adminNote?: string | null;
  /** Read to the caller if they listen on the hotline (failed-delivery alerts). */
  ivrMessage?: string | null;
  cardLast4?: string | null;
}

/**
 * Create (or refresh) a Delivery Issue alert for a delivery+cycle. Deduped: an
 * existing unresolved issue alert for the same delivery + cycle is updated rather
 * than duplicated, so repeated pre-run checks don't spam.
 */
export async function createDeliveryIssueAlert(input: SubscriptionAlertInput): Promise<string> {
  const payload: SubscriptionAlertPayload = {
    delivery_id: input.deliveryId,
    run_id: input.runId ?? null,
    week_number: input.weekNumber,
    cycle_date: input.cycleDate ?? null,
    issue_type: input.issueType,
    admin_note: input.adminNote ?? undefined,
    card_last4: input.cardLast4 ?? null,
  };
  const title = input.title
    || `${weekLabel(input.weekNumber)} Delivery issue: ${subscriptionAlertIssueLabel(input.issueType)}`;

  const { data: existing } = await supabaseAdmin
    .from('admin_alerts')
    .select('id')
    .eq('entity_type', SUBSCRIPTION_DELIVERY_ENTITY)
    .eq('entity_id', input.deliveryId)
    .eq('alert_type', ADMIN_ALERT_TYPES.SUBSCRIPTION_DELIVERY_ISSUE)
    .neq('status', 'resolved')
    .contains('payload', input.cycleDate ? { cycle_date: input.cycleDate } : {})
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('admin_alerts')
      .update({ title, message: subscriptionAlertIssueLabel(input.issueType), payload, user_id: input.userId })
      .eq('id', existing.id);
    return existing.id;
  }

  const { data, error } = await supabaseAdmin
    .from('admin_alerts')
    .insert({
      alert_type: ADMIN_ALERT_TYPES.SUBSCRIPTION_DELIVERY_ISSUE,
      status: 'new',
      entity_type: SUBSCRIPTION_DELIVERY_ENTITY,
      entity_id: input.deliveryId,
      user_id: input.userId,
      title,
      message: subscriptionAlertIssueLabel(input.issueType),
      payload,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create delivery issue alert: ${error.message}`);
  return data!.id as string;
}

/** Create a Failed Delivery alert (also surfaced in the IVR inbox until heard). */
export async function createFailedDeliveryAlert(input: SubscriptionAlertInput): Promise<string> {
  const issueLabel = subscriptionAlertIssueLabel(input.issueType);
  const ivrMessage = input.ivrMessage
    || `Your ${weekLabel(input.weekNumber)} delivery could not be processed${
      input.cardLast4 ? ` because your card ending in ${input.cardLast4} was declined` : ''
    }. ${issueLabel}.`;

  const payload: SubscriptionAlertPayload = {
    delivery_id: input.deliveryId,
    run_id: input.runId ?? null,
    week_number: input.weekNumber,
    cycle_date: input.cycleDate ?? null,
    issue_type: input.issueType,
    ivr_message: ivrMessage,
    admin_note: input.adminNote ?? undefined,
    card_last4: input.cardLast4 ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from('admin_alerts')
    .insert({
      alert_type: ADMIN_ALERT_TYPES.SUBSCRIPTION_FAILED_DELIVERY,
      status: 'new',
      entity_type: SUBSCRIPTION_DELIVERY_ENTITY,
      entity_id: input.deliveryId,
      user_id: input.userId,
      title: input.title || `${weekLabel(input.weekNumber)} Delivery failed: ${issueLabel}`,
      message: input.adminNote || issueLabel,
      payload,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create failed-delivery alert: ${error.message}`);
  return data!.id as string;
}

/**
 * Mark a subscription alert as resolved (admin or self-service). When a user
 * fixes their card/address on the hotline we auto-resolve their open alerts.
 */
export async function resolveSubscriptionAlertsForUser(
  userId: string,
  alertTypes: readonly string[] = SUBSCRIPTION_ALERT_TYPES,
): Promise<void> {
  await supabaseAdmin
    .from('admin_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('alert_type', alertTypes as string[])
    .neq('status', 'resolved');
}

/** Count unheard, unresolved Failed Delivery alerts for a user (IVR inbox). */
export async function getUnheardFailedDeliveryAlerts(userId: string) {
  const { data } = await supabaseAdmin
    .from('admin_alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('alert_type', ADMIN_ALERT_TYPES.SUBSCRIPTION_FAILED_DELIVERY)
    .neq('status', 'resolved')
    .is('heard_at', null)
    .order('created_at', { ascending: true });
  return data || [];
}

export async function markAlertHeard(alertId: string): Promise<void> {
  await supabaseAdmin
    .from('admin_alerts')
    .update({ heard_at: new Date().toISOString() })
    .eq('id', alertId);
}
