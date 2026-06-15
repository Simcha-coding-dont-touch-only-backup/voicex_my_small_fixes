/**
 * IVR alert inbox: after PIN, if the caller has unheard Failed Delivery alerts,
 * offer to listen. Each alert is read once (then tagged heard); card/address
 * alerts offer a call-to-action that jumps to the fix flow and then back to a
 * retry/skip prompt for the failed delivery.
 */
import { registerHandler } from '../handler-registry.js';
import { base, gather, say, setPostAction } from './subscriptions-shared.js';
import {
  getUnheardFailedDeliveryAlerts,
  markAlertHeard,
} from '../../../lib/subscription-alerts.js';
import { retryRun, skipRun } from '../../../lib/subscription-engine.js';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { SUBSCRIPTION_ALERT_ISSUE_TYPES } from '@voicex/shared';

const CARD_ISSUES = new Set<string>([
  SUBSCRIPTION_ALERT_ISSUE_TYPES.DECLINED_CARD,
  SUBSCRIPTION_ALERT_ISSUE_TYPES.EXPIRED_CARD,
  SUBSCRIPTION_ALERT_ISSUE_TYPES.NO_PAYMENT_METHOD,
]);
const ADDRESS_ISSUES = new Set<string>([
  SUBSCRIPTION_ALERT_ISSUE_TYPES.INVALID_ADDRESS,
  SUBSCRIPTION_ALERT_ISSUE_TYPES.NO_ADDRESS,
]);

function ctaFor(issueType: string | undefined): 'card' | 'address' | null {
  if (!issueType) return null;
  if (CARD_ISSUES.has(issueType)) return 'card';
  if (ADDRESS_ISSUES.has(issueType)) return 'address';
  return null;
}

// Entry right after PIN/registration success.
registerHandler('subscriptions_alerts_announce', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const alerts = await getUnheardFailedDeliveryAlerts(userId);
  if (alerts.length === 0) {
    return say(ctx, '', 'main_menu');
  }
  const n = alerts.length;
  return gather(
    `You have ${n} ${n === 1 ? 'alert' : 'alerts'}. To listen to ${n === 1 ? 'it' : 'them'}, press 1. Otherwise, press 2 to continue.`,
    { ...base(ctx), node_key: 'subscriptions_alerts_choice' },
    { numDigits: 1 },
  );
});

registerHandler('subscriptions_alerts_choice', async (ctx) => {
  if (ctx.req.body.digits === '1') {
    const alerts = await getUnheardFailedDeliveryAlerts(ctx.sessionData.user_id);
    if (alerts.length === 0) return say(ctx, '', 'main_menu');
    return say(ctx, '', 'subscriptions_alerts_read', { alert_ids: alerts.map((a: any) => a.id).join(','), alert_idx: '0' });
  }
  return say(ctx, '', 'main_menu');
});

registerHandler('subscriptions_alerts_read', async (ctx) => {
  const ids = (ctx.sessionData.alert_ids || '').split(',').filter(Boolean);
  const idx = parseInt(ctx.sessionData.alert_idx || '0', 10);
  if (idx >= ids.length) return say(ctx, 'You have no more alerts. Returning to the main menu.', 'main_menu');

  const { data: alert } = await supabaseAdmin.from('admin_alerts').select('*').eq('id', ids[idx]).maybeSingle();
  if (!alert) {
    return say(ctx, '', 'subscriptions_alerts_read', { alert_ids: ids.join(','), alert_idx: String(idx + 1) });
  }
  await markAlertHeard(alert.id);

  const payload = (alert.payload || {}) as any;
  const message = payload.ivr_message || alert.message || alert.title || 'You have a subscription alert.';
  const cta = ctaFor(payload.issue_type);
  const hasNext = idx + 1 < ids.length;

  if (cta) {
    await setPostAction(ctx.callSid, { node: 'subscriptions_alerts_retry', run_id: payload.run_id || undefined });
    const ctaLabel = cta === 'card' ? 'update your subscription card' : 'update your subscription address';
    const nextOpt = hasNext ? ' Press 2 to hear the next alert.' : '';
    return gather(
      `${message} Press 1 to ${ctaLabel} now.${nextOpt}`,
      { ...base(ctx), node_key: 'subscriptions_alerts_action', alert_ids: ids.join(','), alert_idx: String(idx), cta },
      { numDigits: 1, timeout: 12 },
    );
  }

  // No call to action: read it, then move on.
  if (hasNext) {
    return say(ctx, message, 'subscriptions_alerts_read', { alert_ids: ids.join(','), alert_idx: String(idx + 1) });
  }
  return say(ctx, `${message} Returning to the main menu.`, 'main_menu');
});

registerHandler('subscriptions_alerts_action', async (ctx) => {
  const ids = (ctx.sessionData.alert_ids || '').split(',').filter(Boolean);
  const idx = parseInt(ctx.sessionData.alert_idx || '0', 10);
  const cta = ctx.sessionData.cta;
  const digits = ctx.req.body.digits;

  if (digits === '1') {
    // Jump to the fix flow; the post-action (set in _read) bounces back to retry.
    return say(ctx, '', cta === 'address' ? 'subscriptions_address_menu' : 'subscriptions_card_menu');
  }
  // Press 2 (or anything else): clear pending post-action and hear the next alert.
  await setPostAction(ctx.callSid, null);
  return say(ctx, '', 'subscriptions_alerts_read', { alert_ids: ids.join(','), alert_idx: String(idx + 1) });
});

registerHandler('subscriptions_alerts_retry', async (ctx) => {
  const runId = ctx.sessionData.run_id;
  const digits = ctx.req.body.digits;

  if (!runId) {
    return say(ctx, 'Your subscription has been updated. Returning to the main menu.', 'main_menu');
  }

  if (digits === '1') {
    const result = await retryRun(runId, 'hotline');
    if (result.status === 'processed' || result.status === 'partial') {
      return say(ctx, 'Your delivery has been processed successfully. Returning to the main menu.', 'main_menu');
    }
    return say(ctx, 'We were still unable to process your delivery. Our team has been notified. Returning to the main menu.', 'main_menu');
  }
  if (digits === '2') {
    await skipRun(runId, 'hotline');
    return say(ctx, 'This delivery has been skipped. Returning to the main menu.', 'main_menu');
  }

  return gather(
    'Press 1 to retry your failed delivery now. Press 2 to skip this delivery.',
    { ...base(ctx), node_key: 'subscriptions_alerts_retry', run_id: runId },
    { numDigits: 1 },
  );
});
