import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

interface CartProduct {
  name: string;
  voicex_id: string;
}

interface CartItemRow {
  id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  catalog_products: CartProduct | null;
}

interface CartRow {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  users: { name: string; email: string; phone: string } | null;
  cart_items: CartItemRow[];
}

export function CartsPage() {
  const [carts, setCarts] = useState<CartRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const perPage = 20;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (statusFilter) params.set('status', statusFilter);
    apiGet<any>(`/carts?${params}`).then((r) => {
      setCarts(r.data || []);
      setTotal(r.total || 0);
    });
  };

  useEffect(() => { load(); }, [page, statusFilter]);

  const cartTotal = (items: CartItemRow[]) =>
    items.reduce((sum, i) => sum + i.quantity * i.unit_price_cents, 0);

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">Active Carts</h2>

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">Active &amp; Abandoned</option>
          <option value="active">Active</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="w-8 px-3 py-3" />
              <th className="px-6 py-3 font-medium">Cart ID</th>
              <th className="px-6 py-3 font-medium">User</th>
              <th className="px-6 py-3 font-medium">Items</th>
              <th className="px-6 py-3 font-medium">Total</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {carts.map((cart) => {
              const expanded = expandedId === cart.id;
              const items = cart.cart_items || [];
              return (
                <Fragment key={cart.id}>
                  <tr className="border-b hover:bg-gray-50">
                    <td className="px-3 py-3">
                      {items.length > 0 && (
                        <button
                          onClick={() => setExpandedId(expanded ? null : cart.id)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-indigo-600">
                      {cart.id.slice(-8)}
                    </td>
                    <td className="px-6 py-3">
                      <Link to={`/users/${cart.user_id}`} className="text-indigo-600 hover:underline">
                        {cart.users?.name || 'N/A'}
                      </Link>
                      <div className="text-xs text-gray-400">{cart.users?.phone || cart.users?.email || ''}</div>
                    </td>
                    <td className="px-6 py-3 text-gray-500">{items.length}</td>
                    <td className="px-6 py-3">${(cartTotal(items) / 100).toFixed(2)}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        cart.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {cart.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {new Date(cart.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                  {expanded && items.length > 0 && (
                    <tr className="border-b bg-gray-50/50">
                      <td colSpan={7} className="px-10 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-gray-400">
                              <th className="pb-1 pr-4 font-medium">Product</th>
                              <th className="pb-1 pr-4 font-medium">VoiceX ID</th>
                              <th className="pb-1 pr-4 font-medium">Qty</th>
                              <th className="pb-1 font-medium">Unit Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => (
                              <tr key={item.id} className="text-gray-600">
                                <td className="py-0.5 pr-4">{item.catalog_products?.name || item.product_id.slice(-8)}</td>
                                <td className="py-0.5 pr-4 font-mono">{item.catalog_products?.voicex_id || '—'}</td>
                                <td className="py-0.5 pr-4">{item.quantity}</td>
                                <td className="py-0.5">${(item.unit_price_cents / 100).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {carts.length === 0 && (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">No active carts found</td></tr>
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t px-6 py-3">
          <span className="text-sm text-gray-500">{total} carts</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"><ChevronLeft size={16} /></button>
            <span className="px-3 py-1 text-sm">Page {page}</span>
            <button onClick={() => setPage(page + 1)} disabled={page * perPage >= total}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
