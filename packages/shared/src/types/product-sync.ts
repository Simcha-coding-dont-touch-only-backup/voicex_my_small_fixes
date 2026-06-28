export type ProductSyncActorKind = 'admin' | 'system' | 'checkout';

export type ProductSyncTrigger =
  | 'auto'
  | 'manual_full'
  | 'manual_single'
  | 'manual_bulk'
  | 'checkout'
  | 'admin_cart_checkout';

export type ProductHistoryChangeType = 'price' | 'status' | 'amazon_availability';

export type ProductSyncUnavailableReason = 'out_of_stock' | 'asin_not_found';

export interface ProductHistoryEntry {
  id: string;
  product_id: string;
  change_type: ProductHistoryChangeType;
  old_value: string | null;
  new_value: string | null;
  actor_kind: ProductSyncActorKind;
  actor_label: string;
  actor_admin_user_id: string | null;
  created_at: string;
}

export interface ProductSyncRun {
  id: string;
  trigger: ProductSyncTrigger;
  status: 'running' | 'completed' | 'paused' | 'failed';
  actor_kind: ProductSyncActorKind;
  actor_label: string;
  actor_admin_user_id: string | null;
  total_count: number;
  processed_count: number;
  changed_count: number;
  unverified_count: number;
  order_id: number | null;
  user_id: string | null;
  caller_phone: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface ProductSyncRunItem {
  id: string;
  run_id: string;
  product_id: string;
  old_amazon_price_cents: number | null;
  new_amazon_price_cents: number | null;
  direction: 'up' | 'down' | null;
  became_unavailable: boolean;
  unavailable_reason?: ProductSyncUnavailableReason | null;
  stale?: boolean;
  stale_reason?: string | null;
  created_at: string;
}

export function amazonAvailabilityStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'in_stock':
      return 'In stock';
    case 'out_of_stock':
      return 'Out of stock';
    case 'asin_not_found':
      return 'ASIN not found';
    case 'unknown':
      return 'Unknown';
    default:
      return status ?? 'N/A';
  }
}

export function productSyncTriggerLabel(trigger: ProductSyncTrigger): string {
  switch (trigger) {
    case 'auto':
      return 'Auto';
    case 'manual_full':
      return 'Manual Full';
    case 'manual_single':
      return 'Manual Single';
    case 'manual_bulk':
      return 'Manual Bulk';
    case 'checkout':
      return 'Checkout';
    case 'admin_cart_checkout':
      return 'Admin Cart Checkout';
    default:
      return trigger;
  }
}

export type SyncJobStatus = 'idle' | 'running' | 'paused';

export interface SyncJobState {
  status: SyncJobStatus;
  total: number;
  processed: number;
  changed: number;
  currentProductId: string | null;
  currentProductName: string | null;
  startedAt: string | null;
  runId: string | null;
  pauseRequested: boolean;
  lastError: string | null;
}
