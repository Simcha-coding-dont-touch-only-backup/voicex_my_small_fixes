import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../lib/api';
import { fmtDateTime, money, ModalShell } from './ui';

function actorLabel(ev: any): string {
  if (ev.actor_type === 'admin') return ev.admin_users?.name ? `Admin (${ev.admin_users.name})` : 'Admin';
  if (ev.actor_type === 'hotline') return 'Customer (Hotline)';
  return 'System';
}

export function HistoryModal({
  subscriptionId,
  deliveryId,
  weekNumber,
  onClose,
}: {
  subscriptionId: string;
  deliveryId?: string;
  weekNumber?: number;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    void (async () => {
      const q = deliveryId ? `?delivery_id=${deliveryId}` : '';
      const res = await apiGet<any>(`/subscriptions/${subscriptionId}/history${q}`);
      setEvents(res.data || []);
      if (deliveryId) {
        const ord = await apiGet<any>(`/subscriptions/deliveries/${deliveryId}/orders`);
        setOrders(ord.data || []);
      }
    })();
  }, [subscriptionId, deliveryId]);

  return (
    <ModalShell onClose={onClose} wide>
      <h3 className="mb-4 text-lg font-semibold">
        History{weekNumber ? ` — Week ${weekNumber}` : ''}
      </h3>

      {orders.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-sm font-semibold">Orders</h4>
          <ul className="divide-y rounded border text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between px-3 py-2">
                <span>
                  {o.order_id ? (
                    <Link to={`/admin/orders/${o.order_id}`} className="text-indigo-600 hover:underline">Order #{o.order_id}</Link>
                  ) : '—'}
                  <span className="ml-2 text-gray-400">{fmtDateTime(o.processed_at)}</span>
                </span>
                <span className="capitalize text-gray-600">{o.status} · {money(o.total_cents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h4 className="mb-2 text-sm font-semibold">Activity</h4>
      <ul className="space-y-2 text-sm">
        {events.map((ev) => (
          <li key={ev.id} className="rounded border px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="font-medium capitalize">{String(ev.event_type).replace(/_/g, ' ')}</span>
              <span className="text-xs text-gray-400">{fmtDateTime(ev.created_at)}</span>
            </div>
            <div className="text-xs text-gray-500">By {actorLabel(ev)}</div>
            {ev.details && (
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-gray-500">{JSON.stringify(ev.details)}</pre>
            )}
          </li>
        ))}
        {events.length === 0 && <li className="py-4 text-center text-gray-400">No history yet.</li>}
      </ul>

      <div className="mt-5 text-right">
        <button className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200" onClick={onClose}>Close</button>
      </div>
    </ModalShell>
  );
}
