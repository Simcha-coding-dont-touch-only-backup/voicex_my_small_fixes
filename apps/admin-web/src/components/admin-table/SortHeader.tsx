import { ArrowDown, ArrowUp } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

interface SortHeaderProps {
  /** Visible column label. */
  label: string;
  /** Backend sort key passed to `onSort`. */
  field: string;
  /** Currently active sort field. */
  sortBy: string;
  /** Direction of the active sort. */
  sortDir: SortDir;
  /**
   * Called when the user clicks the header.
   * Convention used across admin lists: clicking the active field flips the
   * direction; clicking a different field switches to it and starts at `desc`.
   * The shared `useAdminTableQuery` hook implements this for you.
   */
  onSort: (field: string) => void;
  /** Optional extra classes appended to the `<th>`. */
  className?: string;
  /** Override the default `px-6 py-3 font-medium`. */
  thClassName?: string;
}

/**
 * Sortable `<th>`. Renders an up/down chevron pair where the currently active
 * direction is highlighted, sets `aria-sort`, and keeps the click target inside
 * a `<button>` so it stays keyboard accessible.
 *
 * Designed to slot directly into existing `<thead><tr>` rows alongside plain
 * `<th>` cells, so adopting it is a one-for-one swap.
 */
export function SortHeader({
  label,
  field,
  sortBy,
  sortDir,
  onSort,
  className = '',
  thClassName = 'px-6 py-3 font-medium',
}: SortHeaderProps) {
  const active = sortBy === field;
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th className={`${thClassName} ${className}`.trim()} scope="col" aria-sort={ariaSort}>
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        onClick={() => onSort(field)}
        title={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span
          className="inline-flex shrink-0 flex-col items-center justify-center leading-none text-gray-300"
          aria-hidden
        >
          <ArrowUp
            size={12}
            className={active && sortDir === 'asc' ? 'text-indigo-600' : undefined}
            strokeWidth={active && sortDir === 'asc' ? 2.5 : 2}
          />
          <ArrowDown
            size={12}
            className={`-mt-0.5 ${active && sortDir === 'desc' ? 'text-indigo-600' : ''}`}
            strokeWidth={active && sortDir === 'desc' ? 2.5 : 2}
          />
        </span>
      </button>
    </th>
  );
}
