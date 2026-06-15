import { useCallback, useEffect, useState } from 'react';
import { Pencil, History, CreditCard, Bell } from 'lucide-react';
import { weekLabel } from '@voicex/shared';
import { apiGet, apiPost } from '../lib/api';
import {
  money,
  fmtDate,
  fmtDateTime,
  DeliveryStatusBadge,
  RunStatusBadge,
} from '../components/subscriptions/ui';
import { PackageModal } from '../components/subscriptions/PackageModal';
import { CheckoutModal } from '../components/subscriptions/CheckoutModal';
import { HistoryModal } from '../components/subscriptions/HistoryModal';
import { AlertsModal } from '../components/subscriptions/AlertsModal';
import { PauseModal } from '../components/subscriptions/PauseModal';
import { QueueDetailModal } from '../components/subscriptions/QueueDetailModal';

const DISPLAY_STATUSES = ['active', 'temp_paused', 'perm_paused', 'failed'] as const;
const QUEUE_STATUSES = ['pending', 'issue', 'processed', 'partial', 'failed', 'skipped'] as const;

type Tab = 'management' | 'queue';

export function SubscriptionsPage() {
  const [tab, setTab] = useState<Tab>('management');
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-gray-800">Subscriptions</h2>
        <div className="inline-flex rounded-lg border bg-white p-1">
          <button
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === 'management' ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}
            onClick={() => setTab('management')}
          >
            Management
          </button>
          <button
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === 'queue' ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}
            onClick={() => setTab('queue')}
          >
            Queue
          </button>
        </div>
      </div>
      {tab === 'management' ? <ManagementTab /> : <QueueTab />}
    </div>
  );
}

// ============================================================
// Management tab
// ============================================================

function ManagementTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [pkg, setPkg] = useState<{ deliveryId: string; week: number } | null>(null);
  const [checkout, setCheckout] = useState<string | null>(null);
  const [history, setHistory] = useState<{ subId: string; deliveryId?: string; week?: number } | null>(null);
  const [alerts, setAlerts] = useState<string | null>(null);
  const [pause, setPause] = useState<{ deliveryId: string; week: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ per_page: '50' });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiGet<any>(`/subscriptions?${params}`);
      setRows(res.data || []);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const openPackage = async (subId: string, week: number, deliveryId: string | null) => {
    let id = deliveryId;
    if (!id) {
      const res = await apiPost<any>(`/subscriptions/${subId}/deliveries/${week}/ensure`, {});
      id = res.data?.delivery_id ?? null;
    }
    if (!id) return;
    setPkg({ deliveryId: id, week });
  };

  const activate = async (deliveryId: string) => {
    await apiPost(`/subscriptions/deliveries/${deliveryId}/activate`, {});
    await load();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); void load(); }}
          className="flex gap-2"
        >
          <input
            className="rounded border px-3 py-2 text-sm"
            placeholder="Search name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">Search</button>
        </form>
        <select className="rounded border px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {DISPLAY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No subscriptions found.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.subscription_id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-800">{row.customer_name}</div>
                  <div className="text-sm text-gray-500">{row.phone || 'No phone'} · {row.email || 'No email'}</div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span><span className="text-gray-500">Products:</span> {row.total_products}</span>
                  <span><span className="text-gray-500">Total:</span> {money(row.total_cost_cents)}</span>
                  <button className="inline-flex items-center gap-1 rounded border px-2 py-1 text-gray-600 hover:bg-gray-50" onClick={() => setCheckout(row.subscription_id)} title="Checkout (address & card)">
                    <CreditCard size={16} />
                  </button>
                  <button className="relative inline-flex items-center gap-1 rounded border px-2 py-1 text-gray-600 hover:bg-gray-50" onClick={() => setAlerts(row.subscription_id)} title="Alerts">
                    <Bell size={16} />
                    {row.open_alert_count > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{row.open_alert_count}</span>
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((w, i) => {
                  const card = row.weeks[i];
                  if (!card || card.products === 0) {
                    return (
                      <div key={w} className="flex flex-col justify-between rounded-lg border border-dashed bg-gray-50 p-3">
                        <div className="text-sm font-medium text-gray-500">{weekLabel(w)}</div>
                        <div className="text-xs text-gray-400">Empty package</div>
                        <button className="mt-2 inline-flex w-fit items-center gap-1 rounded border bg-white px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50" onClick={() => openPackage(row.subscription_id, w, card?.delivery_id ?? null)}>
                          <Pencil size={12} /> Edit
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={w} className="rounded-lg border p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-700">{weekLabel(w)}</span>
                        <div className="flex gap-1">
                          <button className="rounded p-1 text-gray-500 hover:bg-gray-100" title="Edit package" onClick={() => openPackage(row.subscription_id, w, card.delivery_id)}><Pencil size={14} /></button>
                          <button className="rounded p-1 text-gray-500 hover:bg-gray-100" title="History" onClick={() => setHistory({ subId: row.subscription_id, deliveryId: card.delivery_id, week: w })}><History size={14} /></button>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">Products: {card.products} · {money(card.cost_cents)}</div>
                      <div className="mt-2"><DeliveryStatusBadge status={card.display_status} /></div>
                      <div className="mt-1 text-[11px] text-gray-500">
                        {card.display_status === 'active' && card.next_cycle_date && <>Next: {fmtDate(card.next_cycle_date)}</>}
                        {card.display_status === 'temp_paused' && <>Resumes: {fmtDate(card.pause_resume_date)}</>}
                        {card.display_status === 'perm_paused' && <>Paused: {fmtDate(card.paused_at)}</>}
                        {card.display_status === 'failed' && <>Failed delivery</>}
                      </div>
                      <div className="mt-2">
                        {card.status === 'active' ? (
                          <button className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100" onClick={() => setPause({ deliveryId: card.delivery_id, week: w })}>Pause</button>
                        ) : (
                          <button className="rounded bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100" onClick={() => activate(card.delivery_id)}>Activate</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {pkg && <PackageModal deliveryId={pkg.deliveryId} weekNumber={pkg.week} onClose={() => setPkg(null)} onChanged={load} />}
      {checkout && <CheckoutModal subscriptionId={checkout} onClose={() => setCheckout(null)} onChanged={load} />}
      {history && <HistoryModal subscriptionId={history.subId} deliveryId={history.deliveryId} weekNumber={history.week} onClose={() => setHistory(null)} />}
      {alerts && <AlertsModal subscriptionId={alerts} onClose={() => setAlerts(null)} onChanged={load} />}
      {pause && <PauseModal deliveryId={pause.deliveryId} weekNumber={pause.week} onClose={() => setPause(null)} onChanged={load} />}
    </div>
  );
}

// ============================================================
// Queue tab
// ============================================================

function QueueTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [detail, setDetail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ per_page: '50' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiGet<any>(`/subscription-queue?${params}`);
      setRows(res.data || []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="mb-4">
        <select className="rounded border px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {QUEUE_STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-2">Customer</th>
                <th>Week</th>
                <th>Cycle Date</th>
                <th>Status</th>
                <th>Total</th>
                <th>Processed</th>
                <th>Order</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="px-4 py-2">
                    <div>{r.customer_name}</div>
                    <div className="text-xs text-gray-400">{r.phone || ''}</div>
                  </td>
                  <td>Week {r.week_number}</td>
                  <td>{fmtDate(r.cycle_date)}</td>
                  <td><RunStatusBadge status={r.status} /></td>
                  <td>{money(r.total_cents)}</td>
                  <td className="text-xs text-gray-500">{r.status === 'pending' ? `Est. ${fmtDateTime(r.scheduled_at)}` : fmtDateTime(r.processed_at)}</td>
                  <td>{r.order_id ? `#${r.order_id}` : '—'}</td>
                  <td className="px-2 text-right">
                    <button className="rounded border px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50" onClick={() => setDetail(r.id)}>Details</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">No subscription runs.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {detail && <QueueDetailModal runId={detail} onClose={() => setDetail(null)} onChanged={load} />}
    </div>
  );
}
