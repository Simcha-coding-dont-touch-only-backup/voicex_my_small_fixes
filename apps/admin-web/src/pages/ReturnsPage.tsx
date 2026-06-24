import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Trash2, AlertTriangle, Plus, X } from 'lucide-react';
import { apiGet, apiPatch, apiDelete } from '../lib/api';
import { formatUsdFromCents } from '../lib/product-price';
import { EndlessTail, PaginationFooter, SortHeader, useAdminTableQuery } from '../components/admin-table';

type ReturnStatus = 'pending' | 'processing' | 'complete' | 'cancelled' | 'rejected';

const RETURN_STATUS_OPTIONS: ReturnStatus[] = ['pending', 'processing', 'complete', 'cancelled', 'rejected'];

interface ReturnRow {
  id: string;
  order_id: string;
  user_id: string;
  status: ReturnStatus;
  source: string;
  item_subtotal_cents: number;
  tax_refund_cents: number;
  amazon_refund_cents: number;
  refunded: boolean;
  created_at: string;
  users?: { name: string | null; email: string | null } | null;
  orders?: { created_at: string; status: string } | null;
  item_count: number;
  total_qty: number;
  total_fees_cents: number;
  customer_refund_cents: number;
}

interface ListResponse {
  success: boolean;
  data: ReturnRow[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'pending':
      return 'bg-amber-100 text-amber-800';
    case 'processing':
      return 'bg-blue-100 text-blue-800';
    case 'complete':
      return 'bg-green-100 text-green-800';
    case 'cancelled':
    case 'rejected':
      return 'bg-gray-200 text-gray-600';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function emitReturnsCountRefresh() {
  window.dispatchEvent(new CustomEvent('voicex:returns-count-refresh'));
}

export function ReturnsPage() {
  const [statusFilter, setStatusFilter] = useState<ReturnStatus | ''>('');
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReturnRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const table = useAdminTableQuery<ReturnRow>({
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
        const r = await apiGet<ListResponse>(`/returns?${params}`);
        setError('');
        return { data: r.data || [], total: r.total || 0 };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load returns');
        return { data: [], total: 0 };
      }
    },
  });

  const rows = table.rows;
  const { page, perPage, total, sortBy, sortDir, paginationMode } = table;

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/returns/${deleteTarget.id}`);
      table.setRows((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      table.setTotal((t) => Math.max(0, t - 1));
      setDeleteTarget(null);
      emitReturnsCountRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete return');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-800">Returns</h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              table.setPage(1);
              setStatusFilter(e.target.value as ReturnStatus | '');
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {RETURN_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <SortHeader label="Return #" field="id" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName="px-4 py-3 font-medium" />
              <SortHeader label="Order #" field="order_id" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Items</th>
              <SortHeader label="Item Subtotal" field="item_subtotal_cents" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium">Tax Refund</th>
              <th className="px-4 py-3 font-medium">Customer Refund</th>
              <SortHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium">Refunded</th>
              <SortHeader label="Created" field="created_at" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-6 py-12 text-center text-gray-500">No returns match your filters.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setDetailId(row.id)} className="font-medium text-indigo-600 hover:underline">
                      {row.id}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/admin/orders/${row.order_id}`} className="text-indigo-600 hover:underline">
                      {row.order_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/admin/users/${row.user_id}`} className="text-gray-700 hover:underline">
                      {row.users?.name || 'N/A'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{row.item_count} ({row.total_qty})</td>
                  <td className="px-4 py-3 tabular-nums">{formatUsdFromCents(row.item_subtotal_cents)}</td>
                  <td className="px-4 py-3 tabular-nums">{formatUsdFromCents(row.tax_refund_cents)}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums">{formatUsdFromCents(row.customer_refund_cents)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.refunded ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(row.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setDetailId(row.id)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600" title="View / manage return">
                        <Eye size={16} />
                      </button>
                      <button type="button" onClick={() => setDeleteTarget(row)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Delete return">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <EndlessTail
          paginationMode={paginationMode}
          hasMore={table.hasMoreEndless}
          isLoadingMore={table.isLoadingMore}
          total={total}
          sentinelRef={table.sentinelRef}
          itemLabel="return"
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
          itemLabel="Return"
          itemLabelPlural="Returns"
        />
      </div>

      {detailId && (
        <ReturnDetailModal
          returnId={detailId}
          onClose={() => setDetailId(null)}
          onSaved={(updated) => {
            table.setRows((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
            emitReturnsCountRefresh();
          }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete return {deleteTarget.id}</h3>
            </div>
            <p className="mb-6 text-sm text-gray-600">
              Deleting this return releases the returned quantity back to the order so it can be returned again. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface FeeDraft {
  name: string;
  amount_cents: number;
}

function ReturnDetailModal({
  returnId,
  onClose,
  onSaved,
}: {
  returnId: string;
  onClose: () => void;
  onSaved: (updated: Partial<ReturnRow> & { id: string }) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [status, setStatus] = useState<ReturnStatus>('pending');
  const [taxDollars, setTaxDollars] = useState('0.00');
  const [amazonDollars, setAmazonDollars] = useState('0.00');
  const [refunded, setRefunded] = useState(false);
  const [notes, setNotes] = useState('');
  const [fees, setFees] = useState<FeeDraft[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGet<any>(`/returns/${returnId}`)
      .then((r) => {
        if (!active) return;
        const d = r.data;
        setData(d);
        setStatus(d.status);
        setTaxDollars((d.tax_refund_cents / 100).toFixed(2));
        setAmazonDollars((d.amazon_refund_cents / 100).toFixed(2));
        setRefunded(!!d.refunded);
        setNotes(d.notes || '');
        setFees((d.order_return_fees || []).map((f: any) => ({ name: f.name, amount_cents: f.amount_cents })));
      })
      .catch((err) => active && setSaveError(err instanceof Error ? err.message : 'Failed to load return'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [returnId]);

  const dollarsToCents = (v: string) => Math.round(parseFloat(v || '0') * 100) || 0;

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const body = {
        status,
        tax_refund_cents: dollarsToCents(taxDollars),
        amazon_refund_cents: dollarsToCents(amazonDollars),
        refunded,
        notes: notes.trim() ? notes.trim() : null,
        fees: fees
          .filter((f) => f.name.trim())
          .map((f) => ({ name: f.name.trim(), amount_cents: f.amount_cents })),
      };
      const r = await apiPatch<any>(`/returns/${returnId}`, body);
      onSaved({ id: returnId, status: r.data?.status ?? status, tax_refund_cents: body.tax_refund_cents, amazon_refund_cents: body.amazon_refund_cents, refunded });
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save return');
    } finally {
      setSaving(false);
    }
  };

  const totalFeesCents = fees.reduce((s, f) => s + (f.amount_cents || 0), 0);
  const customerRefundCents = data ? data.item_subtotal_cents + dollarsToCents(taxDollars) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Return {returnId}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-gray-500">Loading…</p>
        ) : !data ? (
          <p className="py-8 text-center text-red-600">{saveError || 'Return not found'}</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Order:</span> <Link to={`/admin/orders/${data.order_id}`} className="text-indigo-600 hover:underline">{data.order_id}</Link></div>
              <div><span className="text-gray-500">Customer:</span> <Link to={`/admin/users/${data.user_id}`} className="text-indigo-600 hover:underline">{data.users?.name || 'N/A'}</Link></div>
              <div><span className="text-gray-500">Source:</span> {data.source}</div>
              <div><span className="text-gray-500">Created:</span> {new Date(data.created_at).toLocaleString()}</div>
              {data.orders?.external_order_id && (
                <div>
                  <span className="text-gray-500">Amazon Order:</span>{' '}
                  <a
                    href={`https://www.amazon.com/gp/css/order-details?orderID=${encodeURIComponent(data.orders.external_order_id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-indigo-600 hover:underline"
                  >
                    {data.orders.external_order_id}
                  </a>
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">VoiceX ID</th>
                    <th className="px-3 py-2 font-medium">Qty</th>
                    <th className="px-3 py-2 font-medium">Unit Price</th>
                    <th className="px-3 py-2 font-medium">Amazon Price</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.order_return_items || []).map((item: any) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{item.product_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{item.voicex_id}</td>
                      <td className="px-3 py-2">{item.quantity}</td>
                      <td className="px-3 py-2 tabular-nums">{formatUsdFromCents(item.unit_price_cents)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatUsdFromCents(item.amazon_price_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value as ReturnStatus)} className="w-full rounded-lg border px-3 py-2 text-sm">
                  {RETURN_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">Cancelled/Rejected release the reserved quantity and are excluded from stats.</p>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={refunded} onChange={(e) => setRefunded(e.target.checked)} />
                  Customer has been refunded
                </label>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Item subtotal</label>
                <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm tabular-nums">{formatUsdFromCents(data.item_subtotal_cents)}</div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Tax refund ($)</label>
                <input type="number" step="0.01" min="0" value={taxDollars} onChange={(e) => setTaxDollars(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Amazon refund ($)</label>
                <input type="number" step="0.01" min="0" value={amazonDollars} onChange={(e) => setAmazonDollars(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Customer refund (items + tax)</label>
                <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm font-semibold tabular-nums">{formatUsdFromCents(customerRefundCents)}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">Extra fees</label>
                <button type="button" onClick={() => setFees((p) => [...p, { name: '', amount_cents: 0 }])} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                  <Plus size={14} /> Add fee
                </button>
              </div>
              {fees.length === 0 ? (
                <p className="text-xs text-gray-400">No fees added.</p>
              ) : (
                <div className="space-y-2">
                  {fees.map((fee, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={fee.name}
                        placeholder="Fee name (e.g. Restocking)"
                        onChange={(e) => setFees((p) => p.map((f, i) => (i === idx ? { ...f, name: e.target.value } : f)))}
                        className="flex-1 rounded-lg border px-3 py-2 text-sm"
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={(fee.amount_cents / 100).toFixed(2)}
                        onChange={(e) => setFees((p) => p.map((f, i) => (i === idx ? { ...f, amount_cents: Math.round(parseFloat(e.target.value || '0') * 100) || 0 } : f)))}
                        className="w-28 rounded-lg border px-3 py-2 text-sm"
                      />
                      <button type="button" onClick={() => setFees((p) => p.filter((_, i) => i !== idx))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <p className="text-xs text-gray-500">Total fees: {formatUsdFromCents(totalFeesCents)}</p>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}

            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={() => void handleSave()} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
