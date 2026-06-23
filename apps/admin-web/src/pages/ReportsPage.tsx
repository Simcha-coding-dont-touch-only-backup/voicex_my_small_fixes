import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiDownload } from '../lib/api';
import { Download, FileSpreadsheet } from 'lucide-react';
import { productSyncTriggerLabel, type ProductSyncTrigger } from '@voicex/shared';

type ReportType =
  | 'purchases'
  | 'returned-items'
  | 'subscription-revenue'
  | 'subscription-paused'
  | 'subscription-failed'
  | 'subscription-products'
  | 'product-sync';

const REPORT_TABS: { id: ReportType; label: string }[] = [
  { id: 'purchases', label: 'Purchases' },
  { id: 'returned-items', label: 'Returned Items' },
  { id: 'product-sync', label: 'Product Sync' },
  { id: 'subscription-revenue', label: 'Monthly Subscription Revenue' },
  { id: 'subscription-paused', label: 'Paused Subscriptions' },
  { id: 'subscription-failed', label: 'Failed Subscriptions' },
  { id: 'subscription-products', label: 'Most-Subscribed Products' },
];

const EXPORTABLE: ReportType[] = ['purchases', 'returned-items'];

function money(cents: number | null | undefined): string {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

export function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('purchases');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState<any[] | null>(null);
  const [totals, setTotals] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [subscribers, setSubscribers] = useState<{ product: string; detail: any[] } | null>(null);
  const [syncTrigger, setSyncTrigger] = useState<'all' | ProductSyncTrigger>('all');

  const switchReport = (type: ReportType) => {
    if (type === reportType) return;
    setReportType(type);
    setData(null);
    setTotals(null);
  };

  const buildParams = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (reportType === 'product-sync' && syncTrigger !== 'all') params.set('trigger', syncTrigger);
    return params;
  };

  const handleLoad = async () => {
    setLoading(true);
    try {
      const res = await apiGet<any>(`/reports/${reportType}?${buildParams()}`);
      setData(res.data || []);
      setTotals(res.totals || null);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    const filename = `${reportType}-report.xlsx`;
    await apiDownload(`/reports/${reportType}/export?${buildParams()}`, filename);
  };

  const isSub = reportType.startsWith('subscription-');

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">Reports</h2>

      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => switchReport(tab.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              reportType === tab.id ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold">{REPORT_TABS.find((t) => t.id === reportType)?.label}</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm text-gray-600">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border px-3 py-2 text-sm" />
          </div>
          {reportType === 'product-sync' && (
            <div>
              <label className="mb-1 block text-sm text-gray-600">Source</label>
              <select
                value={syncTrigger}
                onChange={(e) => setSyncTrigger(e.target.value as 'all' | ProductSyncTrigger)}
                className="rounded border px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="auto">Auto</option>
                <option value="manual_full">Manual Full</option>
                <option value="manual_single">Manual Single</option>
                <option value="manual_bulk">Manual Bulk</option>
                <option value="checkout">Checkout</option>
              </select>
            </div>
          )}
          <button onClick={handleLoad} disabled={loading} className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
            {loading ? 'Loading...' : 'View Report'}
          </button>
          {data && data.length > 0 && EXPORTABLE.includes(reportType) && (
            <button onClick={handleExport} className="flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700">
              <Download size={16} /> Export Excel
            </button>
          )}
        </div>
      </div>

      {data !== null && (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          {data.length === 0 ? (
            <div className="flex items-center justify-center gap-3 py-12 text-gray-400">
              <FileSpreadsheet size={24} />
              <span>No data in this date range</span>
            </div>
          ) : reportType === 'purchases' ? (
            <PurchasesTable data={data} />
          ) : reportType === 'returned-items' ? (
            <ReturnedItemsTable data={data} />
          ) : reportType === 'product-sync' ? (
            <ProductSyncTable data={data} />
          ) : reportType === 'subscription-revenue' ? (
            <RevenueTable data={data} totals={totals} />
          ) : reportType === 'subscription-paused' ? (
            <PausedTable data={data} totals={totals} />
          ) : reportType === 'subscription-failed' ? (
            <FailedTable data={data} totals={totals} />
          ) : (
            <ProductsTable data={data} onSubscribers={(p, d) => setSubscribers({ product: p, detail: d })} />
          )}
        </div>
      )}

      {subscribers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSubscribers(null)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Subscribers — {subscribers.product}</h3>
            <ul className="space-y-1 text-sm">
              {subscribers.detail.map((s, i) => (
                <li key={i}>{s.name} — {s.weeks.join(', ')}</li>
              ))}
            </ul>
            <div className="mt-4 text-right">
              <button className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200" onClick={() => setSubscribers(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PurchasesTable({ data }: { data: any[] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b bg-gray-50 text-left text-gray-500">
        <th className="px-6 py-3 font-medium">Date</th><th className="px-6 py-3 font-medium">Customer</th><th className="px-6 py-3 font-medium">Product</th>
        <th className="px-6 py-3 font-medium">VoiceX ID</th><th className="px-6 py-3 font-medium">Qty</th><th className="px-6 py-3 font-medium">Unit Price</th><th className="px-6 py-3 font-medium">Total</th>
      </tr></thead>
      <tbody>
        {data.map((item: any, idx: number) => (
          <tr key={idx} className="border-b">
            <td className="px-6 py-3 text-gray-500">{new Date(item.orders?.created_at).toLocaleDateString()}</td>
            <td className="px-6 py-3">{item.orders?.users?.name || 'N/A'}</td>
            <td className="px-6 py-3">{item.product_name}</td>
            <td className="px-6 py-3 font-mono text-xs">{item.voicex_id}</td>
            <td className="px-6 py-3">{item.quantity}</td>
            <td className="px-6 py-3">{money(item.unit_price_cents)}</td>
            <td className="px-6 py-3">{money(item.unit_price_cents * item.quantity)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReturnedItemsTable({ data }: { data: any[] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b bg-gray-50 text-left text-gray-500">
        <th className="px-6 py-3 font-medium">Return Date</th><th className="px-6 py-3 font-medium">Return #</th><th className="px-6 py-3 font-medium">Order #</th>
        <th className="px-6 py-3 font-medium">Customer</th><th className="px-6 py-3 font-medium">Product</th><th className="px-6 py-3 font-medium">Qty</th>
        <th className="px-6 py-3 font-medium">Item Subtotal</th><th className="px-6 py-3 font-medium">Status</th>
      </tr></thead>
      <tbody>
        {data.map((item: any, idx: number) => (
          <tr key={idx} className="border-b">
            <td className="px-6 py-3 text-gray-500">{new Date(item.order_returns?.created_at).toLocaleDateString()}</td>
            <td className="px-6 py-3">{item.order_returns?.id}</td>
            <td className="px-6 py-3">{item.order_returns?.order_id}</td>
            <td className="px-6 py-3">{item.order_returns?.users?.name || 'N/A'}</td>
            <td className="px-6 py-3">{item.product_name}</td>
            <td className="px-6 py-3">{item.quantity}</td>
            <td className="px-6 py-3">{money(item.unit_price_cents * item.quantity)}</td>
            <td className="px-6 py-3">{item.order_returns?.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TotalsRow({ children }: { children: React.ReactNode }) {
  return <tr className="border-b-2 bg-indigo-50 font-semibold text-indigo-900">{children}</tr>;
}

function RevenueTable({ data, totals }: { data: any[]; totals: any }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b bg-gray-50 text-left text-gray-500">
        <th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Order ID</th><th className="px-4 py-3 font-medium">Week</th>
        <th className="px-4 py-3 font-medium">Customer</th><th className="px-4 py-3 font-medium">Phone</th><th className="px-4 py-3 font-medium">Products</th>
        <th className="px-4 py-3 font-medium">Order Total</th><th className="px-4 py-3 font-medium">Amazon Total</th><th className="px-4 py-3 font-medium">Profit</th>
      </tr></thead>
      <tbody>
        {totals && (
          <TotalsRow>
            <td className="px-4 py-3" colSpan={5}>Grand Totals</td>
            <td className="px-4 py-3">{totals.total_products}</td>
            <td className="px-4 py-3">{money(totals.order_total_cents)}</td>
            <td className="px-4 py-3">{money(totals.amazon_total_cents)}</td>
            <td className="px-4 py-3">{money(totals.profit_cents)}</td>
          </TotalsRow>
        )}
        {data.map((r: any, idx: number) => (
          <tr key={idx} className="border-b">
            <td className="px-4 py-3 capitalize">{r.status}</td>
            <td className="px-4 py-3">{r.order_id ? <Link className="text-indigo-600 hover:underline" to={`/admin/orders/${r.order_id}`}>#{r.order_id}</Link> : '—'}</td>
            <td className="px-4 py-3">{r.week_label}</td>
            <td className="px-4 py-3">{r.customer_name}</td>
            <td className="px-4 py-3">{r.phone || '—'}</td>
            <td className="px-4 py-3">{r.total_products}</td>
            <td className="px-4 py-3">{money(r.order_total_cents)}</td>
            <td className="px-4 py-3">{money(r.amazon_total_cents)}</td>
            <td className="px-4 py-3">{money(r.profit_cents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PausedTable({ data, totals }: { data: any[]; totals: any }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b bg-gray-50 text-left text-gray-500">
        <th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Week</th><th className="px-4 py-3 font-medium">Customer</th>
        <th className="px-4 py-3 font-medium">Phone</th><th className="px-4 py-3 font-medium">Products</th><th className="px-4 py-3 font-medium">Order Total</th>
      </tr></thead>
      <tbody>
        {totals && (
          <TotalsRow>
            <td className="px-4 py-3" colSpan={4}>Grand Totals</td>
            <td className="px-4 py-3">{totals.total_products}</td>
            <td className="px-4 py-3">{money(totals.order_total_cents)}</td>
          </TotalsRow>
        )}
        {data.map((r: any, idx: number) => (
          <tr key={idx} className="border-b">
            <td className="px-4 py-3">{r.status === 'temp_paused' ? 'Temporarily Paused' : 'Permanently Paused'}</td>
            <td className="px-4 py-3">{r.week_label}</td>
            <td className="px-4 py-3">{r.customer_name}</td>
            <td className="px-4 py-3">{r.phone || '—'}</td>
            <td className="px-4 py-3">{r.total_products}</td>
            <td className="px-4 py-3">{money(r.order_total_cents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FailedTable({ data, totals }: { data: any[]; totals: any }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b bg-gray-50 text-left text-gray-500">
        <th className="px-4 py-3 font-medium">Week</th><th className="px-4 py-3 font-medium">Customer</th><th className="px-4 py-3 font-medium">Phone</th>
        <th className="px-4 py-3 font-medium">Products</th><th className="px-4 py-3 font-medium">Order Total</th>
      </tr></thead>
      <tbody>
        {totals && (
          <TotalsRow>
            <td className="px-4 py-3" colSpan={3}>Grand Totals · Failure Rate {totals.failure_rate}%</td>
            <td className="px-4 py-3">{totals.total_products}</td>
            <td className="px-4 py-3">{money(totals.order_total_cents)}</td>
          </TotalsRow>
        )}
        {data.map((r: any, idx: number) => (
          <tr key={idx} className="border-b">
            <td className="px-4 py-3">{r.week_label}</td>
            <td className="px-4 py-3">{r.customer_name}</td>
            <td className="px-4 py-3">{r.phone || '—'}</td>
            <td className="px-4 py-3">{r.total_products}</td>
            <td className="px-4 py-3">{money(r.order_total_cents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function triggerBadgeClass(trigger: ProductSyncTrigger): string {
  switch (trigger) {
    case 'auto':
      return 'bg-purple-100 text-purple-700';
    case 'checkout':
      return 'bg-blue-100 text-blue-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function sourceLabel(run: any): string {
  if (run.actor_kind === 'system') return 'System';
  if (run.actor_kind === 'checkout') return 'Checkout';
  return run.actor_label || 'Admin';
}

function syncRunProgress(run: {
  status: 'running' | 'completed' | 'paused' | 'failed';
  changed_count: number;
  processed_count: number;
  total_count: number;
  unverified_count?: number;
}): { label: string; className: string } {
  const total = run.total_count ?? 0;
  const changed = run.changed_count ?? 0;
  const processed = run.processed_count ?? 0;
  const unverified = run.unverified_count ?? 0;
  const checked =
    total > 0
      ? processed > 0
        ? `${processed} of ${total}`
        : `? of ${total}`
      : String(processed);
  let label = `${changed} changed · ${checked} checked`;
  if (unverified > 0) {
    label += ` · ${unverified} unverified`;
  }

  let className = 'text-gray-500';
  if (run.status === 'completed') {
    className = 'text-green-600';
  } else if (run.status === 'failed' || run.status === 'paused') {
    className = 'text-red-600';
  }

  return { label, className };
}

function ProductSyncTable({ data }: { data: any[] }) {
  return (
    <div className="space-y-3 bg-gray-50 p-4">
      {data.map((run: any) => {
        const progress = syncRunProgress(run);
        return (
        <div key={run.id} className="rounded-lg bg-white px-6 py-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm font-medium text-gray-800">{new Date(run.started_at).toLocaleString()}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${triggerBadgeClass(run.trigger)}`}>
              {productSyncTriggerLabel(run.trigger)}
            </span>
            <span className="text-xs text-gray-500">by {sourceLabel(run)}</span>
            {run.trigger === 'checkout' && (
              <span className="text-xs text-gray-500">
                {run.customer_name || 'Customer'}
                {run.customer_phone ? ` · ${run.customer_phone}` : ''}
                {run.order_id ? (
                  <>
                    {' · '}
                    <Link className="text-indigo-600 hover:underline" to={`/admin/orders/${run.order_id}`}>
                      #{run.order_id}
                    </Link>
                  </>
                ) : ''}
              </span>
            )}
            <span className={`ml-auto text-xs font-medium ${progress.className}`}>
              {progress.label}
            </span>
          </div>

          {run.items && run.items.length > 0 ? (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4 font-medium">Product</th>
                  <th className="py-2 pr-4 font-medium">VoiceX ID</th>
                  <th className="py-2 pr-4 font-medium">Was</th>
                  <th className="py-2 pr-4 font-medium">Now</th>
                  <th className="py-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {run.items.map((it: any, i: number) => {
                  const down = it.direction === 'down';
                  const up = it.direction === 'up';
                  const colorClass = it.stale
                    ? 'text-amber-600'
                    : it.became_unavailable
                      ? 'text-gray-500'
                      : down
                        ? 'text-green-600'
                        : up
                          ? 'text-red-600'
                          : 'text-gray-700';
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className={`py-2 pr-4 ${colorClass}`}>
                        {it.product_name}
                        {it.stale && (
                          <span
                            className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                            title={it.stale_reason || 'Price could not be verified; cached price used'}
                          >
                            Not verified
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-gray-500">{it.voicex_id || '—'}</td>
                      <td className="py-2 pr-4 text-gray-600">{money(it.old_amazon_price_cents)}</td>
                      <td className={`py-2 pr-4 ${colorClass}`}>
                        {it.stale || it.became_unavailable ? '—' : money(it.new_amazon_price_cents)}
                      </td>
                      <td className={`py-2 ${colorClass}`}>
                        {it.stale
                          ? `Not verified — charged cached price${it.stale_reason ? ` (${it.stale_reason})` : ''}`
                          : it.became_unavailable
                            ? 'No longer available'
                            : down
                              ? `Down ${money((it.old_amazon_price_cents || 0) - (it.new_amazon_price_cents || 0))}`
                              : up
                                ? `Up ${money((it.new_amazon_price_cents || 0) - (it.old_amazon_price_cents || 0))}`
                                : 'No change'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-xs text-gray-400">No changes in this run.</p>
          )}
        </div>
        );
      })}
    </div>
  );
}

function ProductsTable({ data, onSubscribers }: { data: any[]; onSubscribers: (product: string, detail: any[]) => void }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b bg-gray-50 text-left text-gray-500">
        <th className="px-4 py-3 font-medium">Product</th><th className="px-4 py-3 font-medium">VoiceX ID</th><th className="px-4 py-3 font-medium">ASIN</th>
        <th className="px-4 py-3 font-medium">Quantity</th><th className="px-4 py-3 font-medium">Deliveries</th><th className="px-4 py-3 font-medium">Subscribers</th>
      </tr></thead>
      <tbody>
        {data.map((r: any) => (
          <tr key={r.product_id} className="border-b">
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                {r.thumbnail_url && <img src={r.thumbnail_url} alt="" className="h-8 w-8 rounded object-cover" />}
                <Link className="text-indigo-600 hover:underline" to={`/admin/products/${r.product_id}`}>{r.product_name}</Link>
              </div>
            </td>
            <td className="px-4 py-3 font-mono text-xs">{r.voicex_id}</td>
            <td className="px-4 py-3">{r.amazon_asin || '—'}</td>
            <td className="px-4 py-3">{r.quantity}</td>
            <td className="px-4 py-3">{r.deliveries}</td>
            <td className="px-4 py-3">
              <button className="text-indigo-600 hover:underline" onClick={() => onSubscribers(r.product_name, r.subscriber_detail || [])}>{r.subscribers}</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
