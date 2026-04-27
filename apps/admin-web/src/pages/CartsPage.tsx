import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiDelete } from '../lib/api';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

interface CartProduct {
  voicex_id: string;
  voice_name: string | null;
  amazon_name: string | null;
}

interface CartItemRow {
  id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  amazon_price_cents: number;
  local_price_cents: number | null;
  catalog_products: CartProduct | null;
}

interface UserPhone {
  phone_number: string;
  is_primary: boolean;
}

interface CartRow {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  users: { name: string; email: string; is_whitelisted: boolean; user_phones: UserPhone[] } | null;
  cart_items: CartItemRow[];
}

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

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

  const deleteCart = async (cartId: string) => {
    if (!window.confirm('Delete this entire cart? The user will have no cart when they call back.')) return;
    await apiDelete(`/carts/${cartId}`);
    if (expandedId === cartId) setExpandedId(null);
    load();
  };

  const deleteCartItem = async (cartId: string, itemId: string) => {
    if (!window.confirm('Remove this product from the cart?')) return;
    await apiDelete(`/carts/${cartId}/items/${itemId}`);
    load();
  };

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

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
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
              <th className="w-10 px-3 py-3" />
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
                      <div className="text-xs text-gray-400">
                        {cart.users?.user_phones?.find((p) => p.is_primary)?.phone_number
                          || cart.users?.user_phones?.[0]?.phone_number
                          || cart.users?.email || ''}
                      </div>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        cart.users?.is_whitelisted
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {cart.users?.is_whitelisted ? 'Whitelisted' : 'Regular'}
                      </span>
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
                    <td className="px-3 py-3">
                      <button
                        onClick={() => deleteCart(cart.id)}
                        className="text-gray-400 hover:text-red-600"
                        title="Delete cart"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                  {expanded && items.length > 0 && (() => {
                    const isWhitelisted = !!cart.users?.is_whitelisted;
                    let totalBase = 0;
                    let totalMarkedUp = 0;
                    let totalRetail = 0;
                    for (const it of items) {
                      const base = it.amazon_price_cents * it.quantity;
                      // For whitelisted users they pay base price; everyone else pays unit_price_cents (marked-up).
                      const charged = (isWhitelisted ? it.amazon_price_cents : it.unit_price_cents) * it.quantity;
                      const retail = (it.local_price_cents ?? 0) * it.quantity;
                      totalBase += base;
                      totalMarkedUp += charged;
                      totalRetail += retail;
                    }
                    const totalProfit = totalMarkedUp - totalBase;
                    const totalSavings = Math.max(0, totalRetail - totalMarkedUp);

                    return (
                      <tr className="border-b bg-gray-50/50">
                        <td colSpan={8} className="px-10 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-400">
                                <th className="pb-1 pr-4 font-medium">Product</th>
                                <th className="pb-1 pr-4 font-medium">VoiceX ID</th>
                                <th className="pb-1 pr-4 font-medium">Qty</th>
                                <th className="pb-1 pr-4 font-medium">Unit Price</th>
                                <th className="pb-1 pr-4 font-medium">Retail</th>
                                <th className="pb-1 pr-4 font-medium">Saving</th>
                                <th className="pb-1 w-8" />
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((item) => {
                                const charged = isWhitelisted ? item.amazon_price_cents : item.unit_price_cents;
                                const lineCharged = charged * item.quantity;
                                const lineRetail = (item.local_price_cents ?? 0) * item.quantity;
                                const lineSavings = item.local_price_cents != null
                                  ? Math.max(0, lineRetail - lineCharged)
                                  : null;
                                return (
                                  <tr key={item.id} className="text-gray-600">
                                    <td className="py-0.5 pr-4">{item.catalog_products?.voice_name || item.catalog_products?.amazon_name || item.product_id.slice(-8)}</td>
                                    <td className="py-0.5 pr-4 font-mono">{item.catalog_products?.voicex_id || '—'}</td>
                                    <td className="py-0.5 pr-4">{item.quantity}</td>
                                    <td className="py-0.5 pr-4">{fmt(charged)}</td>
                                    <td className="py-0.5 pr-4">
                                      {item.local_price_cents != null ? fmt(item.local_price_cents) : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="py-0.5 pr-4">
                                      {lineSavings != null && lineSavings > 0
                                        ? <span className="text-emerald-600">{fmt(lineSavings)}</span>
                                        : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="py-0.5">
                                      <button
                                        onClick={() => deleteCartItem(cart.id, item.id)}
                                        className="text-gray-400 hover:text-red-600"
                                        title="Remove product"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-gray-200 text-gray-700">
                                <td colSpan={7} className="pt-2">
                                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                                    <div>
                                      <span className="text-gray-400">Total Base Price: </span>
                                      <span className="font-medium">{fmt(totalBase)}</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-400">Total Marked-Up Price: </span>
                                      <span className="font-medium">{fmt(totalMarkedUp)}</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-400">Total Profit: </span>
                                      <span className={`font-medium ${totalProfit > 0 ? 'text-indigo-600' : ''}`}>{fmt(totalProfit)}</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-400">Total Retail Price: </span>
                                      <span className="font-medium">{fmt(totalRetail)}</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-400">Total Savings: </span>
                                      <span className={`font-medium ${totalSavings > 0 ? 'text-emerald-600' : ''}`}>{fmt(totalSavings)}</span>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </td>
                      </tr>
                    );
                  })()}
                </Fragment>
              );
            })}
            {carts.length === 0 && (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-400">No active carts found</td></tr>
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
