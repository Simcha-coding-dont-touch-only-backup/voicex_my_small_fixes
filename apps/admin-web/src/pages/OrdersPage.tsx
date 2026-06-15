import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { EndlessTail, PaginationFooter, SortHeader, useAdminTableQuery } from '../components/admin-table';

const ORDER_TYPE_OPTIONS: { id: string; label: string }[] = [
  { id: 'cart', label: 'Cart' },
  { id: '1', label: 'Week 1' },
  { id: '2', label: 'Week 2' },
  { id: '3', label: 'Week 3' },
  { id: '4', label: 'Week 4' },
];

function orderTypeLabel(order: any): string {
  return order.subscription_week_number ? `Week ${order.subscription_week_number}` : 'Cart';
}

export function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);

  const toggleType = (id: string) => {
    setTypeFilter((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
    table.setPage(1);
  };

  const table = useAdminTableQuery<any>({
    defaultSort: { field: 'created_at', dir: 'desc' },
    defaultPerPage: 20,
    filterKey: `${statusFilter}|${dateFrom}|${dateTo}|${typeFilter.join(',')}`,
    fetcher: ({ page, perPage, sortBy, sortDir }) => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (statusFilter) params.set('status', statusFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (typeFilter.length > 0) params.set('type', typeFilter.join(','));
      return apiGet<any>(`/orders?${params}`).then((r) => ({
        data: r.data || [],
        total: r.total || 0,
      }));
    },
  });
  const orders = table.rows;
  const { page, perPage, total, sortBy, sortDir, paginationMode } = table;

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">Orders</h2>

      <div className="mb-4 flex flex-wrap gap-3">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); table.setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); table.setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm" placeholder="From" />
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); table.setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm" placeholder="To" />
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-medium text-gray-500">Type:</span>
          {ORDER_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggleType(opt.id)}
              className={`rounded-full border px-3 py-1 text-xs ${typeFilter.includes(opt.id) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <SortHeader label="Order ID" field="id" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} />
              <th className="px-6 py-3 font-medium">Customer</th>
              <th className="px-6 py-3 font-medium">Type</th>
              <th className="px-6 py-3 font-medium">Items</th>
              <SortHeader label="Total" field="total_cents" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} />
              <th className="px-6 py-3 font-medium">Fulfillment</th>
              <SortHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} />
              <SortHeader label="Date" field="created_at" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} />
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
                <td className="px-6 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${order.subscription_week_number ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                    {orderTypeLabel(order)}
                  </span>
                </td>
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
              <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-400">No orders found</td></tr>
            )}
          </tbody>
        </table>

        <EndlessTail
          paginationMode={paginationMode}
          hasMore={table.hasMoreEndless}
          isLoadingMore={table.isLoadingMore}
          total={total}
          sentinelRef={table.sentinelRef}
          itemLabel="order"
        />

        <PaginationFooter
          page={page}
          perPage={perPage}
          total={total}
          loadedCount={orders.length}
          paginationMode={paginationMode}
          onPageChange={table.setPage}
          onPerPageChange={table.setPerPage}
          onPaginationModeChange={table.switchPaginationMode}
          itemLabel="Order"
          itemLabelPlural="Orders"
        />
      </div>
    </div>
  );
}
