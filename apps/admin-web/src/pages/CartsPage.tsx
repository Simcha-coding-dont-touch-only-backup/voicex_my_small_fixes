import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiDelete, apiPatch } from '../lib/api';
import { ChevronDown, ChevronUp, Trash2, ShoppingCart } from 'lucide-react';
import { EndlessTail, PaginationFooter, SortHeader, useAdminTableQuery } from '../components/admin-table';
import { InlineConfirmPopover } from '../components/InlineConfirmPopover';
import { AdminCartCheckoutModal } from '../components/AdminCartCheckoutModal';

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
  markup_percent: number;
  live_unit_price_cents: number | null;
  live_amazon_price_cents: number | null;
  live_local_price_cents: number | null;
  live_markup_percent: number;
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
  live_total_cents?: number;
  users: {
    name: string;
    email: string;
    is_whitelisted: boolean;
    custom_markup_percent: number | null;
    user_phones: UserPhone[];
  } | null;
  cart_items: CartItemRow[];
}

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function userMarkupBadge(user: CartRow['users']) {
  if (user?.is_whitelisted) {
    return { label: 'Whitelisted', className: 'bg-amber-100 text-amber-700' };
  }
  if (user?.custom_markup_percent != null) {
    return { label: `${user.custom_markup_percent}%`, className: 'bg-indigo-100 text-indigo-700' };
  }
  return { label: 'Regular', className: 'bg-slate-100 text-slate-600' };
}

export function CartsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingQtyItemId, setEditingQtyItemId] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState('');
  const [savingQty, setSavingQty] = useState(false);
  const [confirmDeleteCartId, setConfirmDeleteCartId] = useState<string | null>(null);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [checkoutCart, setCheckoutCart] = useState<CartRow | null>(null);

  const table = useAdminTableQuery<CartRow>({
    defaultSort: { field: 'created_at', dir: 'desc' },
    defaultPerPage: 20,
    filterKey: statusFilter,
    fetcher: ({ page, perPage, sortBy, sortDir }) => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (statusFilter) params.set('status', statusFilter);
      return apiGet<any>(`/carts?${params}`).then((r) => ({
        data: r.data || [],
        total: r.total || 0,
      }));
    },
  });
  const carts = table.rows;
  const { page, perPage, total, sortBy, sortDir, paginationMode } = table;

  const cartTotal = (cart: CartRow, items: CartItemRow[]) =>
    cart.live_total_cents ?? items.reduce((sum, i) => {
      if (i.live_unit_price_cents == null) return sum;
      return sum + i.quantity * i.live_unit_price_cents;
    }, 0);

  const cancelQtyEdit = () => {
    setEditingQtyItemId(null);
    setQtyDraft('');
  };

  const updateCartItemQty = async (cartId: string, itemId: string, currentQty: number) => {
    const quantity = parseInt(qtyDraft, 10);
    if (!quantity || quantity < 1) {
      cancelQtyEdit();
      return;
    }
    if (quantity === currentQty) {
      cancelQtyEdit();
      return;
    }

    setSavingQty(true);
    try {
      await apiPatch(`/carts/${cartId}/items/${itemId}`, { quantity });
      cancelQtyEdit();
      table.refresh();
    } catch (err) {
      alert((err as Error).message || 'Failed to update quantity');
      setQtyDraft(String(currentQty));
      setEditingQtyItemId(null);
    } finally {
      setSavingQty(false);
    }
  };

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">Active Carts</h2>

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); table.setPage(1); }}
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
              <SortHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} />
              <SortHeader label="Created" field="created_at" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} />
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {carts.map((cart) => {
              const expanded = expandedId === cart.id;
              const items = cart.cart_items || [];
              const markupBadge = userMarkupBadge(cart.users);
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
                      <Link to={`/admin/users/${cart.user_id}`} className="text-indigo-600 hover:underline">
                        {cart.users?.name || 'N/A'}
                      </Link>
                      <div className="text-xs text-gray-400">
                        {cart.users?.user_phones?.find((p) => p.is_primary)?.phone_number
                          || cart.users?.user_phones?.[0]?.phone_number
                          || cart.users?.email || ''}
                      </div>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${markupBadge.className}`}>
                        {markupBadge.label}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500">{items.length}</td>
                    <td className="px-6 py-3">${(cartTotal(cart, items) / 100).toFixed(2)}</td>
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
                      <div className="flex items-center gap-1">
                        {cart.status === 'active' && items.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteCartId(null);
                              setConfirmDeleteItemId(null);
                              setCheckoutCart(cart);
                            }}
                            className="text-gray-400 hover:text-indigo-600"
                            title="Checkout for customer"
                          >
                            <ShoppingCart size={16} />
                          </button>
                        )}
                        <div className="relative inline-block">
                          <button
                            type="button"
                            aria-pressed={confirmDeleteCartId === cart.id}
                            onClick={() => {
                              setConfirmDeleteItemId(null);
                              setConfirmDeleteCartId((current) => (current === cart.id ? null : cart.id));
                            }}
                            className={`text-gray-400 hover:text-red-600 ${confirmDeleteCartId === cart.id ? 'text-red-600' : ''}`}
                            title="Delete cart"
                          >
                            <Trash2 size={16} />
                          </button>
                          <InlineConfirmPopover
                            open={confirmDeleteCartId === cart.id}
                            confirmLabel="Delete"
                            cancelLabel="Cancel"
                            side="bottom"
                            align="end"
                            onCancel={() => setConfirmDeleteCartId(null)}
                            onConfirm={async () => {
                              await apiDelete(`/carts/${cart.id}`);
                              if (expandedId === cart.id) setExpandedId(null);
                              setConfirmDeleteCartId(null);
                              table.refresh();
                            }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                  {expanded && items.length > 0 && (() => {
                    let totalBase = 0;
                    let totalMarkedUp = 0;
                    let totalRetail = 0;
                    for (const it of items) {
                      const base = (it.live_amazon_price_cents ?? 0) * it.quantity;
                      const charged = (it.live_unit_price_cents ?? 0) * it.quantity;
                      const retail = (it.live_local_price_cents ?? 0) * it.quantity;
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
                                <th className="pb-1 pr-4 font-medium">Snapshot</th>
                                <th className="pb-1 pr-4 font-medium">Total</th>
                                <th className="pb-1 pr-4 font-medium">Retail</th>
                                <th className="pb-1 pr-4 font-medium">Saving</th>
                                <th className="pb-1 w-8" />
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((item) => {
                                const unitPrice = item.live_unit_price_cents;
                                const lineCharged = (unitPrice ?? 0) * item.quantity;
                                const lineRetail = (item.live_local_price_cents ?? 0) * item.quantity;
                                const lineSavings = item.live_local_price_cents != null && unitPrice != null
                                  ? Math.max(0, lineRetail - lineCharged)
                                  : null;
                                const snapshotDiffers = unitPrice != null && unitPrice !== item.unit_price_cents;
                                return (
                                  <tr key={item.id} className="text-gray-600">
                                    <td className="py-0.5 pr-4">{item.catalog_products?.voice_name || item.catalog_products?.amazon_name || item.product_id.slice(-8)}</td>
                                    <td className="py-0.5 pr-4 font-mono">{item.catalog_products?.voicex_id || '—'}</td>
                                    <td className="py-0.5 pr-4">
                                      {editingQtyItemId === item.id ? (
                                        <input
                                          type="number"
                                          min={1}
                                          autoFocus
                                          value={qtyDraft}
                                          disabled={savingQty}
                                          className="w-12 rounded border px-1 py-0.5 text-xs"
                                          onChange={(e) => setQtyDraft(e.target.value)}
                                          onBlur={() => void updateCartItemQty(cart.id, item.id, item.quantity)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              void updateCartItemQty(cart.id, item.id, item.quantity);
                                            } else if (e.key === 'Escape') {
                                              cancelQtyEdit();
                                            }
                                          }}
                                        />
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingQtyItemId(item.id);
                                            setQtyDraft(String(item.quantity));
                                          }}
                                          className="cursor-pointer rounded px-1 hover:bg-indigo-50 hover:text-indigo-600"
                                          title="Edit quantity"
                                        >
                                          {item.quantity}
                                        </button>
                                      )}
                                    </td>
                                    <td className="py-0.5 pr-4">
                                      {unitPrice != null ? fmt(unitPrice) : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className={`py-0.5 pr-4 ${snapshotDiffers ? 'text-amber-600' : 'text-gray-400'}`}>
                                      {fmt(item.unit_price_cents)}
                                    </td>
                                    <td className="py-0.5 pr-4 font-medium">{fmt(lineCharged)}</td>
                                    <td className="py-0.5 pr-4">
                                      {item.live_local_price_cents != null ? fmt(item.live_local_price_cents) : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="py-0.5 pr-4">
                                      {lineSavings != null && lineSavings > 0
                                        ? <span className="text-emerald-600">{fmt(lineSavings)}</span>
                                        : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="py-0.5">
                                      <div className="relative inline-block">
                                        <button
                                          type="button"
                                          aria-pressed={confirmDeleteItemId === item.id}
                                          onClick={() => {
                                            setConfirmDeleteCartId(null);
                                            setConfirmDeleteItemId((current) => (current === item.id ? null : item.id));
                                          }}
                                          className={`text-gray-400 hover:text-red-600 ${confirmDeleteItemId === item.id ? 'text-red-600' : ''}`}
                                          title="Remove product"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                        <InlineConfirmPopover
                                          open={confirmDeleteItemId === item.id}
                                          confirmLabel="Remove"
                                          cancelLabel="Cancel"
                                          side="bottom"
                                          align="end"
                                          onCancel={() => setConfirmDeleteItemId(null)}
                                          onConfirm={async () => {
                                            await apiDelete(`/carts/${cart.id}/items/${item.id}`);
                                            setConfirmDeleteItemId(null);
                                            table.refresh();
                                          }}
                                        />
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-gray-200 text-gray-700">
                                <td colSpan={9} className="pt-2">
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

        <EndlessTail
          paginationMode={paginationMode}
          hasMore={table.hasMoreEndless}
          isLoadingMore={table.isLoadingMore}
          total={total}
          sentinelRef={table.sentinelRef}
          itemLabel="cart"
        />

        <PaginationFooter
          page={page}
          perPage={perPage}
          total={total}
          loadedCount={carts.length}
          paginationMode={paginationMode}
          onPageChange={table.setPage}
          onPerPageChange={table.setPerPage}
          onPaginationModeChange={table.switchPaginationMode}
          itemLabel="Cart"
          itemLabelPlural="Carts"
        />
      </div>

      {checkoutCart && (
        <AdminCartCheckoutModal
          cartId={checkoutCart.id}
          userName={checkoutCart.users?.name || checkoutCart.users?.email || 'Customer'}
          onClose={() => setCheckoutCart(null)}
          onComplete={() => table.refresh()}
        />
      )}
    </div>
  );
}
