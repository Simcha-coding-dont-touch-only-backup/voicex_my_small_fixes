// PostgREST (and therefore supabase-js) caps a single request at a default of
// 1000 rows. Any endpoint that fetches a set of rows and then groups, counts,
// aggregates, exports, or builds a filter list from them IN MEMORY will
// silently lose every row past the first 1000 once a table crosses that
// threshold — making the newest data quietly disappear (or filters quietly
// drop matches).
//
// This helper pages through the FULL result set in 1000-row batches so callers
// always see every matching row regardless of table size. Use it instead of a
// bare `.select()` whenever the result is processed in memory rather than being
// the final, already-`.range()`-paginated response sent to the client.
//
// `buildQuery` must return a fresh PostgREST query builder each time it is
// called (filters + ordering applied, but NOT `.range()` — this helper adds
// that). Returning a fresh builder per call avoids reusing/mutating a builder
// across requests.
const DB_PAGE_SIZE = 1000;

// Hard ceiling so a runaway table can never spin forever. Well above expected
// volume for any of these admin views.
export const MAX_FETCH_ROWS = 100_000;

// `truncated` is true when we hit MAX_FETCH_ROWS while the result set still had
// more rows to return. Callers MUST surface this so consumers know the grouped
// / paginated / exported result is incomplete rather than treating partial data
// as the full set.
export async function fetchAllRows<T>(
  buildQuery: () => any
): Promise<{ data: T[]; error: any; truncated: boolean }> {
  const all: T[] = [];
  let from = 0;

  while (from < MAX_FETCH_ROWS) {
    const { data, error } = await buildQuery().range(from, from + DB_PAGE_SIZE - 1);
    if (error) {
      return { data: all, error, truncated: false };
    }
    const batch = (data || []) as T[];
    all.push(...batch);
    if (batch.length < DB_PAGE_SIZE) {
      // Reached the genuine end of the result set.
      return { data: all, error: null, truncated: false };
    }
    from += DB_PAGE_SIZE;
  }

  // We exited the loop because we reached MAX_FETCH_ROWS while the last batch
  // was still full, so there are more matching rows we deliberately did not
  // fetch. The accumulated data is a partial result.
  return { data: all, error: null, truncated: true };
}
