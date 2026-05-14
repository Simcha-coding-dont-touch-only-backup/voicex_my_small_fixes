import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaginationMode } from './PaginationFooter';
import type { SortDir } from './SortHeader';

export interface AdminTableFetcherArgs {
  page: number;
  perPage: number;
  sortBy: string;
  sortDir: SortDir;
}

export interface AdminTableFetcherResult<T> {
  data: T[];
  total: number;
}

export interface UseAdminTableQueryOptions<T> {
  /** Initial sort field/direction. Defaults to `created_at desc`. */
  defaultSort?: { field: string; dir: SortDir };
  /** Initial per-page value. Defaults to 20. */
  defaultPerPage?: number;
  /** Initial pagination mode. Defaults to `'standard'`. */
  defaultPaginationMode?: PaginationMode;
  /**
   * Stable string built from any caller-managed filter state (search box,
   * status select, date pickers, etc). When this changes, the table resets to
   * page 1 and (in endless mode) clears the buffer before re-fetching.
   *
   * The hook automatically appends its own state (perPage/sort) so the caller
   * only needs to encode their own filters.
   */
  filterKey: string;
  /**
   * Loader called whenever the table needs new data. Should resolve with the
   * raw `data` array and the unfiltered `total` (typically straight from the
   * API's `{ data, total }` shape).
   */
  fetcher: (args: AdminTableFetcherArgs) => Promise<AdminTableFetcherResult<T>>;
}

export interface UseAdminTableQueryResult<T> {
  rows: T[];
  setRows: React.Dispatch<React.SetStateAction<T[]>>;
  total: number;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  page: number;
  setPage: (page: number) => void;
  perPage: number;
  setPerPage: (perPage: number) => void;
  sortBy: string;
  sortDir: SortDir;
  /**
   * Toggle direction when `field` matches the current sort, otherwise switch
   * to `field` and start at `desc`. Always resets to page 1.
   */
  handleSort: (field: string) => void;
  paginationMode: PaginationMode;
  switchPaginationMode: (mode: PaginationMode) => void;
  isLoadingMore: boolean;
  /** Attach to the element used to trigger the next-page fetch in endless mode. */
  sentinelRef: React.MutableRefObject<HTMLDivElement | null>;
  hasMoreEndless: boolean;
  totalPages: number;
  /**
   * Re-run the fetcher. In endless mode the buffer is cleared first so the
   * call always returns to page 1.
   */
  refresh: () => void;
}

/**
 * Owns the page/perPage/sort/paginationMode state for an admin list, plus the
 * data buffer, infinite-scroll wiring, and "filters changed → snap back to
 * page 1" behavior. Pages are responsible for their own filter inputs and for
 * building a `filterKey` string the hook can watch.
 *
 * Pair with `<SortHeader>`, `<EndlessTail>`, and `<PaginationFooter>` from
 * this folder for a consistent UI across every admin list.
 */
export function useAdminTableQuery<T>(
  opts: UseAdminTableQueryOptions<T>,
): UseAdminTableQueryResult<T> {
  const [page, setPageState] = useState(1);
  const [perPage, setPerPageState] = useState(opts.defaultPerPage ?? 20);
  const [sortBy, setSortBy] = useState(opts.defaultSort?.field ?? 'created_at');
  const [sortDir, setSortDir] = useState<SortDir>(opts.defaultSort?.dir ?? 'desc');
  const [paginationMode, setPaginationMode] = useState<PaginationMode>(
    opts.defaultPaginationMode ?? 'standard',
  );
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const appendNextRef = useRef(false);
  const lastFilterKeyRef = useRef('');
  /** Bumped at the start of every `load()` so late responses from superseded fetches are ignored. */
  const latestLoadIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetcherRef = useRef(opts.fetcher);
  fetcherRef.current = opts.fetcher;

  // Combine caller filters with our own state so any of them re-fetches.
  const filterKey = `${opts.filterKey}|${perPage}|${sortBy}|${sortDir}`;

  const load = useCallback(() => {
    const loadId = ++latestLoadIdRef.current;

    const filtersChanged =
      lastFilterKeyRef.current !== '' && lastFilterKeyRef.current !== filterKey;
    lastFilterKeyRef.current = filterKey;

    const append = appendNextRef.current;
    appendNextRef.current = false;

    if (paginationMode === 'endless' && filtersChanged) {
      // Re-running with new filters while sitting on page > 1: snap back to
      // page 1, which itself triggers another load() through the dependency
      // array, so we bail here.
      if (page !== 1) {
        setRows([]);
        setIsLoadingMore(true);
        setPageState(1);
        return;
      }
      // Already on page 1: clear the buffer so we don't flash stale rows
      // under the new filter while the fetch is in flight.
      if (!append) setRows([]);
    }

    fetcherRef
      .current({ page, perPage, sortBy, sortDir })
      .then((r) => {
        if (loadId !== latestLoadIdRef.current) return;
        if (append) {
          setRows((prev) => [...prev, ...(r.data || [])]);
        } else {
          setRows(r.data || []);
        }
        setTotal(r.total || 0);
        setIsLoadingMore(false);
      })
      .catch(() => {
        if (loadId !== latestLoadIdRef.current) return;
        setIsLoadingMore(false);
      });
  }, [filterKey, page, perPage, sortBy, sortDir, paginationMode]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const hasMoreEndless = paginationMode === 'endless' && rows.length < total;

  useEffect(() => {
    if (paginationMode !== 'endless') return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (isLoadingMore) return;
        if (page >= totalPages) return;
        // Only advance when the current page's worth of rows has actually
        // arrived. Without this guard a fast scroll can trigger duplicate
        // page advances before the previous fetch has resolved.
        if (rows.length < page * perPage) return;
        appendNextRef.current = true;
        setIsLoadingMore(true);
        setPageState((p) => p + 1);
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [paginationMode, isLoadingMore, page, totalPages, rows.length, perPage]);

  const handleSort = useCallback(
    (field: string) => {
      if (sortBy === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(field);
        setSortDir('desc');
      }
      setPageState(1);
    },
    [sortBy],
  );

  const setPage = useCallback((p: number) => {
    setPageState(p);
  }, []);

  const setPerPage = useCallback(
    (n: number) => {
      setPerPageState(n);
      appendNextRef.current = false;
      if (paginationMode === 'endless') setRows([]);
      setPageState(1);
    },
    [paginationMode],
  );

  const switchPaginationMode = useCallback(
    (mode: PaginationMode) => {
      if (mode === paginationMode) return;
      appendNextRef.current = false;
      setIsLoadingMore(false);
      setRows([]);
      setPaginationMode(mode);
      setPageState(1);
    },
    [paginationMode],
  );

  const refresh = useCallback(() => {
    appendNextRef.current = false;
    if (paginationMode === 'endless') setRows([]);
    if (page !== 1) setPageState(1);
    else load();
  }, [page, paginationMode, load]);

  return {
    rows,
    setRows,
    total,
    setTotal,
    page,
    setPage,
    perPage,
    setPerPage,
    sortBy,
    sortDir,
    handleSort,
    paginationMode,
    switchPaginationMode,
    isLoadingMore,
    sentinelRef,
    hasMoreEndless,
    totalPages,
    refresh,
  };
}
