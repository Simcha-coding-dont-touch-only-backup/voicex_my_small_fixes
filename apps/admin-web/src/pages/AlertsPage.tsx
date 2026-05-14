import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, AlertTriangle } from 'lucide-react';
import { apiDelete, apiGet, apiPatch } from '../lib/api';
import { formatUsdFromCents } from '../lib/product-price';
import { ProductThumbnail } from '../components/ProductThumbnail';
import { getProductDisplayName, type CatalogProduct } from '@voicex/shared';
import { EndlessTail, PaginationFooter, SortHeader, useAdminTableQuery } from '../components/admin-table';

type AlertStatus = 'new' | 'reviewing' | 'resolved';

type EmbeddedProduct = CatalogProduct & {
  thumbnail_url?: string | null;
};

interface AdminAlertRow {
  id: string;
  alert_type: string;
  status: AlertStatus;
  title: string;
  message: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  catalog_products: EmbeddedProduct | null;
  effective_custom_price_cents: number | null;
}

interface ListResponse {
  success: boolean;
  data: AdminAlertRow[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

function statusBadgeClass(status: AlertStatus) {
  switch (status) {
    case 'new':
      return 'bg-red-100 text-red-800';
    case 'reviewing':
      return 'bg-amber-100 text-amber-800';
    case 'resolved':
      return 'bg-green-100 text-green-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function statusLabel(status: AlertStatus) {
  switch (status) {
    case 'new':
      return 'New';
    case 'reviewing':
      return 'Reviewing';
    case 'resolved':
      return 'Resolved';
    default:
      return status;
  }
}

function emitAlertsCountRefresh() {
  window.dispatchEvent(new CustomEvent('voicex:alerts-count-refresh'));
}

export function AlertsPage() {
  const [statusFilter, setStatusFilter] = useState<AlertStatus | ''>('');
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminAlertRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const table = useAdminTableQuery<AdminAlertRow>({
    defaultSort: { field: 'created_at', dir: 'desc' },
    defaultPerPage: 20,
    filterKey: statusFilter,
    fetcher: async ({ page, perPage, sortBy, sortDir }) => {
      try {
        const params = new URLSearchParams({
          page: String(page),
          per_page: String(perPage),
          sort_by: sortBy,
          sort_dir: sortDir,
        });
        if (statusFilter) params.set('status', statusFilter);
        const r = await apiGet<ListResponse>(`/alerts?${params}`);
        setError('');
        return { data: r.data || [], total: r.total || 0 };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load alerts');
        return { data: [], total: 0 };
      }
    },
  });
  const rows = table.rows;
  const { page, perPage, total, sortBy, sortDir, paginationMode } = table;

  const handleStatusChange = async (row: AdminAlertRow, status: AlertStatus) => {
    try {
      await apiPatch(`/alerts/${row.id}`, { status });
      table.setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, status } : x)));
      emitAlertsCountRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/alerts/${deleteTarget.id}`);
      table.setRows((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      table.setTotal((t) => Math.max(0, t - 1));
      setDeleteTarget(null);
      emitAlertsCountRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete alert');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-800">Alerts</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                table.setPage(1);
                setStatusFilter(e.target.value as AlertStatus | '');
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="new">New</option>
              <option value="reviewing">Reviewing</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="px-3 py-3 font-medium w-16">Image</th>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">VoiceX ID</th>
              <th className="px-4 py-3 font-medium">ASIN</th>
              <th className="px-4 py-3 font-medium">Custom price</th>
              <th className="px-4 py-3 font-medium">Local price</th>
              <SortHeader
                label="Status"
                field="status"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={table.handleSort}
                thClassName="px-4 py-3 font-medium"
              />
              <SortHeader
                label="Created"
                field="created_at"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={table.handleSort}
                thClassName="px-4 py-3 font-medium"
              />
              <th className="px-4 py-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                  No alerts match your filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const p = row.catalog_products;
                const name = p ? getProductDisplayName(p) : 'Unknown product';
                const effective =
                  row.effective_custom_price_cents ??
                  (typeof row.payload.effective_custom_price_cents === 'number'
                    ? row.payload.effective_custom_price_cents
                    : null);
                const local =
                  p?.local_price_cents ??
                  (typeof row.payload.local_price_cents === 'number' ? row.payload.local_price_cents : null);

                return (
                  <tr key={row.id} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2">
                      {p && !p.deleted_at ? (
                        <ProductThumbnail
                          thumbnailUrl={p.thumbnail_url ?? null}
                          images={p.amazon_image_urls}
                          alt={name}
                          size={48}
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">
                          —
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p && !p.deleted_at ? (
                        <Link to={`/admin/products/${p.id}`} className="font-medium text-indigo-600 hover:underline">
                          {name}
                        </Link>
                      ) : (
                        <span className="text-gray-600">{name}</span>
                      )}
                      {p?.deleted_at && (
                        <span className="ml-2 text-xs text-amber-600">(trashed)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">
                      {(p?.voicex_id as string | undefined) ?? (row.payload.voicex_id as string) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {(p?.amazon_asin as string | undefined) ?? (row.payload.amazon_asin as string) ?? '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {effective != null ? formatUsdFromCents(effective) : '—'}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-red-600">
                      {local != null ? formatUsdFromCents(local) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                        <span
                          className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}
                        >
                          {statusLabel(row.status)}
                        </span>
                        <select
                          value={row.status}
                          onChange={(e) => void handleStatusChange(row, e.target.value as AlertStatus)}
                          className="max-w-[140px] rounded border border-gray-200 px-2 py-1 text-xs"
                          aria-label="Change alert status"
                        >
                          <option value="new">New</option>
                          <option value="reviewing">Reviewing</option>
                          <option value="resolved">Resolved</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        title="Delete alert"
                        onClick={() => setDeleteTarget(row)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <EndlessTail
          paginationMode={paginationMode}
          hasMore={table.hasMoreEndless}
          isLoadingMore={table.isLoadingMore}
          total={total}
          sentinelRef={table.sentinelRef}
          itemLabel="alert"
        />

        <PaginationFooter
          page={page}
          perPage={perPage}
          total={total}
          loadedCount={rows.length}
          paginationMode={paginationMode}
          onPageChange={table.setPage}
          onPerPageChange={table.setPerPage}
          onPaginationModeChange={table.switchPaginationMode}
          itemLabel="Alert"
          itemLabelPlural="Alerts"
        />
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete alert</h3>
            </div>
            <p className="mb-6 text-sm text-gray-600">
              Remove this alert from the system? This does not change product prices.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
