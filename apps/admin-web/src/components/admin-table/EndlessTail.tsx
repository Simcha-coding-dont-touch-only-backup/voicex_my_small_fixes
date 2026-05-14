import { Loader2 } from 'lucide-react';
import type { MutableRefObject } from 'react';
import type { PaginationMode } from './PaginationFooter';

interface EndlessTailProps {
  paginationMode: PaginationMode;
  hasMore: boolean;
  isLoadingMore: boolean;
  total: number;
  /** Sentinel ref returned from `useAdminTableQuery`. */
  sentinelRef: MutableRefObject<HTMLDivElement | null>;
  itemLabel?: string;
  itemLabelPlural?: string;
}

/**
 * Renders the bits that only matter while endless mode is active:
 *   - an invisible sentinel `<div>` that the hook's `IntersectionObserver`
 *     watches to trigger the next-page fetch,
 *   - a "Loading more…" row while a fetch is in flight,
 *   - an "End of list" cap once everything has been pulled.
 *
 * Render this immediately *after* the table body and *before* the
 * `<PaginationFooter>` so the sentinel sits inside the scrolling list area.
 */
export function EndlessTail({
  paginationMode,
  hasMore,
  isLoadingMore,
  total,
  sentinelRef,
  itemLabel = 'item',
  itemLabelPlural,
}: EndlessTailProps) {
  if (paginationMode !== 'endless') return null;
  const plural = itemLabelPlural ?? `${itemLabel}s`;
  return (
    <>
      {hasMore && <div ref={sentinelRef} className="h-1" aria-hidden="true" />}
      {isLoadingMore && (
        <div className="flex items-center justify-center gap-2 border-t px-6 py-4 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" /> Loading more {plural}...
        </div>
      )}
      {!isLoadingMore && total > 0 && !hasMore && (
        <div className="border-t px-6 py-3 text-center text-xs text-gray-400">
          End of list — all {total} {total === 1 ? itemLabel : plural} loaded.
        </div>
      )}
    </>
  );
}
