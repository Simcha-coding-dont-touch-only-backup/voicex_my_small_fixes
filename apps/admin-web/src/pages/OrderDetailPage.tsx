import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { normalizeOrderNumberInput } from '@voicex/shared';
import { apiGet } from '../lib/api';
import { OrderEtaEditor, normalizeEtaRows, type EtaFormRow } from '../components/OrderEtaEditor';

export function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any>(null);
  const [etaRows, setEtaRows] = useState<EtaFormRow[]>([]);

  useEffect(() => {
    if (!id) return;
    const resolved = normalizeOrderNumberInput(id) || id;
    apiGet<any>(`/orders/${resolved}`).then((r) => {
      setOrder(r.data);
      setEtaRows(normalizeEtaRows(r.data?.order_fulfillment_etas));
    });
  }, [id]);

  if (!order) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={() => navigate('/admin/orders')} className="shrink-0 text-sm text-indigo-600 hover:underline">&larr; Back</button>
        <h2 className="min-w-0 break-words text-xl font-bold text-gray-800 sm:text-2xl">Order {String(order.id)}</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold">Order Info</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2"><dt className="font-medium text-gray-500 w-32">Status</dt><dd>
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                order.status === 'completed' ? 'bg-green-100 text-green-700' :
                order.status === 'failed' ? 'bg-red-100 text-red-700' :
                'bg-yellow-100 text-yellow-700'
              }`}>{order.status}</span>
            </dd></div>
            <div className="flex gap-2"><dt className="font-medium text-gray-500 w-32">Customer</dt><dd>{order.users?.name || 'N/A'}</dd></div>
            <div className="flex gap-2"><dt className="font-medium text-gray-500 w-32">Subtotal</dt><dd>${(order.subtotal_cents / 100).toFixed(2)}</dd></div>
            <div className="flex gap-2"><dt className="font-medium text-gray-500 w-32">Shipping</dt><dd>${(order.shipping_cents / 100).toFixed(2)}</dd></div>
            <div className="flex gap-2"><dt className="font-medium text-gray-500 w-32">Tax</dt><dd>${(order.tax_cents / 100).toFixed(2)}</dd></div>
            <div className="flex gap-2"><dt className="font-medium text-gray-500 w-32">Total</dt><dd className="font-bold">${(order.total_cents / 100).toFixed(2)}</dd></div>
            <div className="flex gap-2"><dt className="font-medium text-gray-500 w-32">Fulfillment</dt><dd>{order.fulfillment_provider || 'rye'}{order.fulfillment_status && order.fulfillment_status !== 'none' ? ` · ${order.fulfillment_status}` : ''}</dd></div>
            {order.external_order_id && <div className="flex gap-2"><dt className="font-medium text-gray-500 w-32">External Order</dt><dd className="font-mono">{order.external_order_id}</dd></div>}
            <div className="flex gap-2"><dt className="font-medium text-gray-500 w-32">Date</dt><dd>{new Date(order.created_at).toLocaleString()}</dd></div>
          </dl>

          {order.addresses && (
            <div className="mt-4 border-t pt-4">
              <h4 className="mb-2 text-sm font-semibold text-gray-700">Shipping Address</h4>
              <p className="text-sm text-gray-600">
                {order.addresses.address1}{order.addresses.address2 ? `, ${order.addresses.address2}` : ''}<br />
                {order.addresses.city}, {order.addresses.state} {order.addresses.zip_code}
              </p>
            </div>
          )}

          <div className="mt-4 border-t pt-4">
            <OrderEtaEditor
              orderId={String(order.id)}
              value={etaRows}
              onChange={setEtaRows}
              onSaved={(updatedOrder) => setOrder(updatedOrder)}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold">Items</h3>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium">ASIN</th>
                  <th className="pb-2 font-medium">Qty</th>
                  <th className="pb-2 font-medium">Unit Price</th>
                  <th className="pb-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.order_items?.map((item: any) => (
                  <tr key={item.id} className="border-b">
                    <td className="py-2">{item.product_name}<span className="ml-2 text-xs text-gray-400">({item.voicex_id})</span></td>
                    <td className="py-2 font-mono text-xs text-gray-500">{item.amazon_asin || '-'}</td>
                    <td className="py-2">{item.quantity}</td>
                    <td className="py-2">${(item.unit_price_cents / 100).toFixed(2)}</td>
                    <td className="py-2">${((item.unit_price_cents * item.quantity) / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold">Events</h3>
            <div className="space-y-3">
              {order.order_events?.map((ev: any) => (
                <div key={ev.id} className="flex items-start gap-3 border-b pb-3 last:border-0">
                  <div className="mt-0.5 h-2 w-2 rounded-full bg-indigo-400" />
                  <div>
                    <p className="text-sm font-medium">{ev.status} <span className="font-normal text-gray-400">via {ev.source}</span></p>
                    <p className="text-xs text-gray-500">{new Date(ev.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
