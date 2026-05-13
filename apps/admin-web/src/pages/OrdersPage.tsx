import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const perPage = 20;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    apiGet<any>(`/orders?${params}`).then((r) => {
      setOrders(r.data || []);
      setTotal(r.total || 0);
    });
  };

  useEffect(() => { load(); }, [page, statusFilter, dateFrom, dateTo]);

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">Orders</h2>

      <div className="mb-4 flex flex-wrap gap-3">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" placeholder="From" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" placeholder="To" />
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Order ID</th>
              <th className="px-6 py-3 font-medium">Customer</th>
              <th className="px-6 py-3 font-medium">Items</th>
              <th className="px-6 py-3 font-medium">Total</th>
              <th className="px-6 py-3 font-medium">Fulfillment</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b hover:bg-gray-50">
                <td className="px-6 py-3">
                  <Link to={`/admin/orders/${order.id}`} className="font-mono text-xs text-indigo-600 hover:underline">
                    {String(order.id)}
                  </Link>
                </td>
                <td className="px-6 py-3">{order.users?.name || 'N/A'}</td>
                <td className="px-6 py-3 text-gray-500">{order.order_items?.length || 0}</td>
                <td className="px-6 py-3">${(order.total_cents / 100).toFixed(2)}</td>
                <td className="px-6 py-3">
                  <div className="text-xs">
                    <span className="font-medium uppercase text-gray-700">{order.fulfillment_provider || 'rye'}</span>
                    {order.fulfillment_status && order.fulfillment_status !== 'none' && (
                      <span className="ml-1 text-gray-500">· {order.fulfillment_status}</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    order.status === 'completed' ? 'bg-green-100 text-green-700' :
                    order.status === 'failed' ? 'bg-red-100 text-red-700' :
                    order.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>{order.status}</span>
                </td>
                <td className="px-6 py-3 text-gray-500">{new Date(order.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">No orders found</td></tr>
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t px-6 py-3">
          <span className="text-sm text-gray-500">{total} orders</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded border px-3 py-1 text-sm disabled:opacity-50"><ChevronLeft size={16} /></button>
            <span className="px-3 py-1 text-sm">Page {page}</span>
            <button onClick={() => setPage(page + 1)} disabled={page * perPage >= total} className="rounded border px-3 py-1 text-sm disabled:opacity-50"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
