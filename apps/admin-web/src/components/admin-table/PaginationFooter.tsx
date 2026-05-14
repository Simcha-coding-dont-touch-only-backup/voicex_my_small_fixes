import { ChevronLeft, ChevronRight, Infinity as InfinityIcon, ListOrdered } from 'lucide-react';

export type PaginationMode = 'standard' | 'endless';

export const DEFAULT_PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500, 1000] as const;

interface PaginationFooterProps {
  page: number;
  perPage: number;
  total: number;
  /** How many rows are currently rendered (only matters for endless mode). */
  loadedCount: number;
  paginationMode: PaginationMode;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  onPaginationModeChange: (mode: PaginationMode) => void;
  /** Singular noun used in "X-Y of Z foo". Defaults to "items". */
  itemLabel?: string;
  /** Plural form. Defaults to `${itemLabel}s`. */
  itemLabelPlural?: string;
  /** Choices in the per-page selector. */
  pageSizeOptions?: readonly number[];
  /** Disable the endless toggle (e.g. when the dataset never paginates). */
  enableEndlessToggle?: boolean;
  /** Max number of page buttons shown in the standard pager. */
  maxPageButtons?: number;
}

/**
 * Up to `max` page indices (1-based), sliding window centered on `page` when
 * there are more pages than fit in the window.
 */
export function visiblePageNumbers(page: number, totalPages: number, max = 5): number[] {
  const n = Math.max(0, totalPages);
  if (n === 0) return [1];
  if (n <= max) return Array.from({ length: n }, (_, i) => i + 1);
  const start = Math.max(1, Math.min(page - Math.floor(max / 2), n - max + 1));
  return Array.from({ length: max }, (_, i) => start + i);
}

/**
 * Footer strip used on every paginated admin list. Renders:
 *   - a range / total counter on the left,
 *   - on the right: a standard/endless mode toggle, the per-page selector,
 *     and (in standard mode) prev/next + numbered page buttons.
 *
 * Stateless — feed it the current values from the parent (typically from
 * `useAdminTableQuery`) and react to its callbacks.
 */
export function PaginationFooter({
  page,
  perPage,
  total,
  loadedCount,
  paginationMode,
  onPageChange,
  onPerPageChange,
  onPaginationModeChange,
  itemLabel = 'item',
  itemLabelPlural,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  enableEndlessToggle = true,
  maxPageButtons = 5,
}: PaginationFooterProps) {
  const plural = itemLabelPlural ?? `${itemLabel}s`;
  const labelForCount = (n: number) => (n === 1 ? itemLabel : plural);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const rangeEnd = total > 0 ? Math.min(page * perPage, total) : 0;
  const rangeStart = total > 0 ? Math.min((page - 1) * perPage + 1, rangeEnd) : 0;
  const pages = visiblePageNumbers(page, totalPages, maxPageButtons);
  const canGoNextPage = page < totalPages;

  let counterText: string;
  if (total === 0) {
    counterText = `0 of 0 ${plural}`;
  } else if (paginationMode === 'endless') {
    counterText = `Showing ${loadedCount} of ${total} ${labelForCount(total)}`;
  } else {
    counterText = `${rangeStart}-${rangeEnd} of ${total} ${labelForCount(total)}`;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3">
      <span className="text-sm text-gray-500">{counterText}</span>
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        {enableEndlessToggle && (paginationMode === 'standard' ? (
          <button
            type="button"
            onClick={() => onPaginationModeChange('endless')}
            className="flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            title="Switch to endless scrolling"
            aria-label="Switch to endless scrolling"
          >
            <InfinityIcon size={16} />
            <span className="hidden sm:inline">Endless</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onPaginationModeChange('standard')}
            className="flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            title="Switch to standard pagination"
            aria-label="Switch to standard pagination"
          >
            <ListOrdered size={16} />
            <span className="hidden sm:inline">Pages</span>
          </button>
        ))}
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <span className="whitespace-nowrap">Per page</span>
          <select
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            aria-label={`${plural} per page`}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {paginationMode === 'standard' && (
          <nav className="flex items-center gap-1" aria-label={`${itemLabel} list pagination`}>
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded border p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex gap-1">
              {pages.map((pNum) =>
                pNum === page ? (
                  <span
                    key={pNum}
                    aria-current="page"
                    className="flex min-w-[2.25rem] items-center justify-center rounded border border-indigo-600 bg-indigo-600 px-2 py-1 text-sm font-medium tabular-nums text-white"
                  >
                    {pNum}
                  </span>
                ) : (
                  <button
                    key={pNum}
                    type="button"
                    onClick={() => onPageChange(pNum)}
                    className="min-w-[2.25rem] rounded border border-gray-200 px-2 py-1 text-sm tabular-nums text-gray-700 hover:bg-gray-50"
                  >
                    {pNum}
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={!canGoNextPage}
              className="rounded border p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
