/**
 * Subscriptions: a user auto-orders products monthly across up to 4 weekly
 * "deliveries". Week N is processed on a fixed day of each month at midnight ET.
 */

/** All subscription processing is anchored to this timezone (handles EST/EDT). */
export const SUBSCRIPTION_TIMEZONE = 'America/New_York';

/** The 4 weekly delivery slots. */
export const SUBSCRIPTION_WEEKS = [1, 2, 3, 4] as const;
export type SubscriptionWeek = (typeof SUBSCRIPTION_WEEKS)[number];

/** Day-of-month each week's delivery is processed (12:00 AM ET). */
export const WEEK_PROCESSING_DAYS: Record<number, number> = { 1: 1, 2: 8, 3: 15, 4: 22 };

/** How many times a user must hear the explanation before it becomes optional. */
export const TERMS_EXPLANATION_REQUIRED_PLAYS = 2;

/** Base scheduling status of a delivery (failed is derived from the latest run). */
export const DELIVERY_STATUSES = ['active', 'temp_paused', 'perm_paused'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** What the admin UI shows: base status plus a derived "failed" indicator. */
export type DeliveryDisplayStatus = DeliveryStatus | 'failed';

export const DELIVERY_RUN_STATUSES = [
  'pending',
  'issue',
  'locked',
  'processing',
  'processed',
  'partial',
  'failed',
  'skipped',
] as const;
export type DeliveryRunStatus = (typeof DELIVERY_RUN_STATUSES)[number];

/** Run statuses that represent a successfully placed (possibly partial) order. */
export const SUCCESSFUL_RUN_STATUSES = ['processed', 'partial'] as const;

export const RUN_ITEM_STATUSES = [
  'included',
  'reduced',
  'skipped_unavailable',
  'skipped_disabled',
] as const;
export type RunItemStatus = (typeof RUN_ITEM_STATUSES)[number];

export type PauseType = 'temporary' | 'permanent';
/** Temporary pause options offered in the IVR / admin. */
export const TEMP_PAUSE_CYCLE_OPTIONS = [1, 3] as const;

const WEEK_ORDINAL_WORDS: Record<number, string> = {
  1: 'First',
  2: 'Second',
  3: 'Third',
  4: 'Fourth',
};

/** "First" / "Second" / ... for a week number. */
export function weekOrdinalWord(week: number): string {
  return WEEK_ORDINAL_WORDS[week] || `Week ${week}`;
}

/** Spoken/displayed label, e.g. "First Week". */
export function weekLabel(week: number): string {
  return `${weekOrdinalWord(week)} Week`;
}

/** Day-of-month a week is processed; throws nothing, defaults to 1. */
export function processingDayForWeek(week: number): number {
  return WEEK_PROCESSING_DAYS[week] ?? 1;
}

export interface Subscription {
  id: string;
  user_id: string;
  subscription_address_id: string | null;
  payment_method_id: string | null;
  terms_explanation_count: number;
  terms_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionDelivery {
  id: string;
  subscription_id: string;
  week_number: number;
  status: DeliveryStatus;
  pause_type: PauseType | null;
  paused_cycles: number | null;
  pause_resume_date: string | null;
  paused_at: string | null;
  next_cycle_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionDeliveryItem {
  id: string;
  delivery_id: string;
  product_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionDeliveryRun {
  id: string;
  delivery_id: string;
  subscription_id: string;
  user_id: string;
  week_number: number;
  cycle_date: string;
  status: DeliveryRunStatus;
  scheduled_at: string | null;
  locked_at: string | null;
  processed_at: string | null;
  /** BIGINT order id; JSON may carry it as string. */
  order_id: string | null;
  sola_ref_num: string | null;
  sola_transaction_id: string | null;
  subtotal_cents: number;
  total_cents: number;
  issue_details: Record<string, unknown> | null;
  failure_details: Record<string, unknown> | null;
  attempt_count: number;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionDeliveryRunItem {
  id: string;
  run_id: string;
  product_id: string | null;
  voicex_id: string;
  product_name: string;
  quantity: number;
  original_quantity: number;
  unit_price_cents: number;
  amazon_price_cents: number;
  status: RunItemStatus;
  reason: string | null;
  created_at: string;
}

export type SubscriptionEventActor = 'admin' | 'hotline' | 'system';

export interface SubscriptionEvent {
  id: string;
  subscription_id: string;
  delivery_id: string | null;
  run_id: string | null;
  event_type: string;
  actor_type: SubscriptionEventActor;
  actor_admin_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

/** Human label for a pause, e.g. for IVR readback "paused for {x}". */
export function pauseDescription(
  pauseType: PauseType | null,
  pausedCycles: number | null,
): string {
  if (pauseType === 'permanent') return 'permanently';
  if (pauseType === 'temporary') {
    if (pausedCycles === 1) return 'the upcoming monthly cycle';
    if (pausedCycles && pausedCycles > 1) return `the next ${pausedCycles} monthly cycles`;
    return 'the upcoming monthly cycle';
  }
  return '';
}
