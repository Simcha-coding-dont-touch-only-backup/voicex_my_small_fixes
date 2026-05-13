import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clipboard, ExternalLink, RefreshCw, Save, XCircle } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import { OrderEtaEditor, normalizeEtaRows, serializeEtaRows, type EtaFormRow } from '../components/OrderEtaEditor';

interface ProviderResponse {
  success: boolean;
  data: {
    amazon_associate_tag: string;
  };
}

interface QueueResponse {
  success: boolean;
  data: any[];
}

function formatCents(cents: number | null | undefined) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

function extractAsin(item: any) {
  if (item.amazon_asin) return item.amazon_asin;
  const url = item.amazon_url || '';
  const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return match?.[1]?.toUpperCase() || '';
}

function buildAmazonCartUrl(order: any, associateTag: string) {
  const params = new URLSearchParams();
  if (associateTag) params.set('AssociateTag', associateTag);

  (order.order_items || []).forEach((item: any, idx: number) => {
    const asin = extractAsin(item);
    if (!asin) return;
    const n = idx + 1;
    params.set(`ASIN.${n}`, asin);
    params.set(`Quantity.${n}`, String(item.quantity || 1));
  });

  return `https://www.amazon.com/gp/aws/cart/add.html?${params.toString()}`;
}

function formatAddress(address: any) {
  if (!address) return '';
  return [
    address.name,
    address.address1,
    address.address2,
    `${address.city}, ${address.state} ${address.zip_code}`.trim(),
    address.country || 'US',
  ].filter(Boolean).join('\n');
}

function formatOrderNote(order: any) {
  const user = order.users || {};
  const items = (order.order_items || []).map((item: any) => {
    const asin = extractAsin(item) || 'NO-ASIN';
    return `- ${asin} x ${item.quantity}: ${item.product_name}`;
  }).join('\n');

  return [
    `VoiceX Order: ${order.id}`,
    `Customer: ${user.name || 'N/A'}`,
    user.email ? `Email: ${user.email}` : '',
    '',
    'Items:',
    items,
    '',
    `Approved customer charge: ${formatCents(order.total_cents)}`,
    order.fulfillment_notes ? `Notes: ${order.fulfillment_notes}` : '',
  ].filter((line) => line !== '').join('\n');
}

function statusBadge(status: string) {
  const classes =
    status === 'queued' ? 'bg-blue-100 text-blue-700' :
    status === 'needs_review' ? 'bg-orange-100 text-orange-700' :
    status === 'ordered' ? 'bg-green-100 text-green-700' :
    status === 'cancelled' ? 'bg-gray-100 text-gray-600' :
    'bg-yellow-100 text-yellow-700';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>{status}</span>;
}

export function FulfillmentPage() {
  const [associateTag, setAssociateTag] = useState('voicexshop20-20');
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);
  const [externalIds, setExternalIds] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [etaRows, setEtaRows] = useState<Record<string, EtaFormRow[]>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [providerRes, queueRes] = await Promise.all([
        apiGet<ProviderResponse>('/fulfillment/provider'),
        apiGet<QueueResponse>('/fulfillment/manual-queue'),
      ]);
      setAssociateTag(providerRes.data.amazon_associate_tag || 'voicexshop20-20');
      const queue = queueRes.data || [];
      setOrders(queue);
      setEtaRows(Object.fromEntries(
        queue.map((order) => [order.id, normalizeEtaRows(order.order_fulfillment_etas)])
      ));
      window.dispatchEvent(new CustomEvent('voicex:fulfillment-count-refresh', {
        detail: { count: queue.length },
      }));
    } catch (err: any) {
      setError(err?.message || 'Failed to load fulfillment data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const queueCount = useMemo(() => orders.length, [orders]);

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const runAction = async (orderId: string, action: 'mark-ordered' | 'cancel' | 'needs-review') => {
    if (action === 'mark-ordered' && !externalIds[orderId]?.trim()) {
      setError('Amazon order number is required before capturing payment.');
      return;
    }
    if (action === 'mark-ordered' && (etaRows[orderId] || []).some((row) => !row.eta_date)) {
      setError('Choose a date for each ETA, or remove the blank ETA row.');
      return;
    }
    if (action === 'cancel' && !window.confirm('Void the Sola hold and cancel this manual order?')) return;

    setActionOrderId(orderId);
    setError('');
    try {
      const body = action === 'mark-ordered'
        ? { external_order_id: externalIds[orderId], fulfillment_notes: notes[orderId], etas: serializeEtaRows(etaRows[orderId] || []) }
        : { fulfillment_notes: notes[orderId] };
      await apiPost(`/fulfillment/manual-queue/${orderId}/${action}`, body);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Action failed');
    } finally {
      setActionOrderId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Fulfillment</h2>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-xl bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Manual Fulfillment Queue</h3>
            <p className="text-sm text-gray-500">{queueCount} queued or review order{queueCount === 1 ? '' : 's'}</p>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">Loading...</div>
        ) : orders.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">No manual fulfillment orders waiting.</div>
        ) : (
          <div className="divide-y">
            {orders.map((order) => {
              const addressText = formatAddress(order.addresses);
              const orderNote = formatOrderNote(order);
              const amazonCartUrl = buildAmazonCartUrl(order, associateTag);
              const hold = (order.order_holds || []).find((h: any) => h.status === 'held');
              const acting = actionOrderId === order.id;

              return (
                <div key={order.id} className="p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/admin/orders/${order.id}`} className="font-mono text-sm font-semibold text-indigo-600 hover:underline">
                          {String(order.id)}
                        </Link>
                        {statusBadge(order.fulfillment_status)}
                        {!hold && <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><AlertTriangle size={12} /> no held auth</span>}
                      </div>
                      <div className="mt-1 text-sm text-gray-600">
                        {order.users?.name || 'N/A'} · {formatCents(order.total_cents)} approved · {new Date(order.created_at).toLocaleString()}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <a
                        href={amazonCartUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded bg-orange-600 px-3 py-2 text-xs font-medium text-white hover:bg-orange-700"
                      >
                        <ExternalLink size={14} />
                        Open Amazon Cart
                      </a>
                      <button
                        type="button"
                        onClick={() => copyText(`address-${order.id}`, addressText)}
                        className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <Clipboard size={14} />
                        {copied === `address-${order.id}` ? 'Copied' : 'Copy Address'}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyText(`note-${order.id}`, orderNote)}
                        className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <Clipboard size={14} />
                        {copied === `note-${order.id}` ? 'Copied' : 'Copy Order Note'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-gray-50 text-left text-gray-500">
                            <th className="px-3 py-2 font-medium">Item</th>
                            <th className="px-3 py-2 font-medium">ASIN</th>
                            <th className="px-3 py-2 text-right font-medium">Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(order.order_items || []).map((item: any) => (
                            <tr key={item.id} className="border-b last:border-0">
                              <td className="px-3 py-2">
                                <div className="font-medium text-gray-800">{item.product_name}</div>
                                <div className="font-mono text-xs text-gray-400">{item.voicex_id}</div>
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-gray-600">{extractAsin(item) || 'missing'}</td>
                              <td className="px-3 py-2 text-right font-mono">{item.quantity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-gray-500">Amazon Order Number</label>
                        <input
                          value={externalIds[order.id] ?? order.external_order_id ?? ''}
                          onChange={(e) => setExternalIds((prev) => ({ ...prev, [order.id]: e.target.value }))}
                          className="mt-1 w-full rounded border px-3 py-2 text-sm"
                          placeholder="e.g. 113-1234567-1234567"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500">Admin Notes</label>
                        <textarea
                          value={notes[order.id] ?? order.fulfillment_notes ?? ''}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [order.id]: e.target.value }))}
                          className="mt-1 h-20 w-full rounded border px-3 py-2 text-sm"
                          placeholder="Optional fulfillment notes"
                        />
                      </div>
                      <OrderEtaEditor
                        orderId={order.id}
                        value={etaRows[order.id] || []}
                        onChange={(rows) => setEtaRows((prev) => ({ ...prev, [order.id]: rows }))}
                        onSaved={(updatedOrder) => {
                          setOrders((prev) => prev.map((existing) => existing.id === updatedOrder.id ? updatedOrder : existing));
                        }}
                        disabled={acting}
                      />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => runAction(order.id, 'mark-ordered')}
                          disabled={acting || !hold}
                          className="inline-flex items-center justify-center gap-1 rounded bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          <Save size={14} />
                          Capture & Mark Ordered
                        </button>
                        <button
                          type="button"
                          onClick={() => runAction(order.id, 'needs-review')}
                          disabled={acting}
                          className="inline-flex items-center justify-center gap-1 rounded bg-orange-100 px-3 py-2 text-xs font-medium text-orange-700 hover:bg-orange-200 disabled:opacity-50"
                        >
                          <AlertTriangle size={14} />
                          Needs Review
                        </button>
                        <button
                          type="button"
                          onClick={() => runAction(order.id, 'cancel')}
                          disabled={acting || !hold}
                          className="inline-flex items-center justify-center gap-1 rounded bg-red-100 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                        >
                          <XCircle size={14} />
                          Cancel & Void Hold
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
