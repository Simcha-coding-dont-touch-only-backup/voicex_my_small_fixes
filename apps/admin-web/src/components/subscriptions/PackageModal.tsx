import { useEffect, useState } from 'react';
import { weekLabel } from '@voicex/shared';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api';
import { money, ModalShell } from './ui';

interface Line {
  product_id: string;
  voicex_id: string;
  product_name: string;
  amazon_asin: string | null;
  thumbnail_url: string | null;
  amazon_price_cents: number;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}

type SortKey = 'name' | 'price' | 'qty';

export function PackageModal({
  deliveryId,
  weekNumber,
  onClose,
  onChanged,
}: {
  deliveryId: string;
  weekNumber: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('name');
  const [transferFor, setTransferFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiGet<any>(`/subscriptions/deliveries/${deliveryId}/items`);
      setLines(res.data.lines || []);
      setSubtotal(res.data.subtotal_cents || 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryId]);

  const refresh = async () => {
    await load();
    onChanged();
  };

  const sorted = [...lines].sort((a, b) => {
    if (sort === 'price') return a.unit_price_cents - b.unit_price_cents;
    if (sort === 'qty') return a.quantity - b.quantity;
    return a.product_name.localeCompare(b.product_name);
  });

  const updateQty = async (productId: string, quantity: number) => {
    if (quantity < 1) return;
    setBusy(true);
    try {
      await apiPatch(`/subscriptions/deliveries/${deliveryId}/items/${productId}`, { quantity });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (productId: string) => {
    setBusy(true);
    try {
      await apiDelete(`/subscriptions/deliveries/${deliveryId}/items/${productId}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const transfer = async (productId: string, toWeek: number) => {
    setBusy(true);
    try {
      await apiPost(`/subscriptions/deliveries/${deliveryId}/transfer`, { product_id: productId, to_week: toWeek });
      setTransferFor(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const runSearch = async () => {
    if (!search.trim()) { setResults([]); return; }
    const params = new URLSearchParams({ search: search.trim(), per_page: '10', status: 'active' });
    const res = await apiGet<any>(`/catalog/products?${params}`);
    setResults(res.data || []);
  };

  const addProduct = async (productId: string) => {
    setBusy(true);
    try {
      await apiPost(`/subscriptions/deliveries/${deliveryId}/items`, { product_id: productId, quantity: 1 });
      setSearch('');
      setResults([]);
      await refresh();
    } catch (e: any) {
      alert(e.message || 'Failed to add product');
    } finally {
      setBusy(false);
    }
  };

  const otherWeeks = [1, 2, 3, 4].filter((w) => w !== weekNumber);

  return (
    <ModalShell onClose={onClose} wide>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">{weekLabel(weekNumber)} Delivery Package</h3>
        <div className="text-sm text-gray-500">
          Sort by{' '}
          <select className="rounded border px-2 py-1 text-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="price">Price</option>
            <option value="qty">Quantity</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="py-2">Product</th>
              <th>VoiceX ID</th>
              <th>ASIN</th>
              <th>Amazon</th>
              <th>Price</th>
              <th>Qty</th>
              <th>Line Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => (
              <tr key={l.product_id} className="border-b align-middle">
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    {l.thumbnail_url && <img src={l.thumbnail_url} alt="" className="h-8 w-8 rounded object-cover" />}
                    <span>{l.product_name}</span>
                  </div>
                </td>
                <td>{l.voicex_id}</td>
                <td>{l.amazon_asin || '-'}</td>
                <td>{money(l.amazon_price_cents)}</td>
                <td>{money(l.unit_price_cents)}</td>
                <td>
                  <input
                    type="number"
                    min={1}
                    defaultValue={l.quantity}
                    disabled={busy}
                    className="w-16 rounded border px-2 py-1"
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (v && v !== l.quantity) void updateQty(l.product_id, v);
                    }}
                  />
                </td>
                <td>{money(l.line_total_cents)}</td>
                <td className="whitespace-nowrap text-right">
                  {transferFor === l.product_id ? (
                    <span className="inline-flex items-center gap-1">
                      {otherWeeks.map((w) => (
                        <button key={w} disabled={busy} className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100" onClick={() => transfer(l.product_id, w)}>
                          W{w}
                        </button>
                      ))}
                      <button className="text-xs text-gray-400" onClick={() => setTransferFor(null)}>cancel</button>
                    </span>
                  ) : (
                    <span className="inline-flex gap-2">
                      <button className="text-xs text-indigo-600 hover:underline" onClick={() => setTransferFor(l.product_id)}>Transfer</button>
                      <button className="text-xs text-red-600 hover:underline" onClick={() => remove(l.product_id)}>Remove</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={8} className="py-4 text-center text-gray-400">This package is empty.</td></tr>
            )}
          </tbody>
        </table>
      )}

      <div className="mt-3 text-right text-sm font-semibold">Package total: {money(subtotal)}</div>

      <div className="mt-5 border-t pt-4">
        <h4 className="mb-2 text-sm font-semibold">Add a product</h4>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border px-3 py-2 text-sm"
            placeholder="Search by name or VoiceX ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
          />
          <button className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700" onClick={() => void runSearch()}>Search</button>
        </div>
        {results.length > 0 && (
          <ul className="mt-2 divide-y rounded border">
            {results.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{p.voice_name || p.amazon_name || 'Unknown'} <span className="text-gray-400">({p.voicex_id})</span></span>
                <button disabled={busy} className="rounded bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100" onClick={() => addProduct(p.id)}>Add</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 flex justify-end">
        <button className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200" onClick={onClose}>Close</button>
      </div>
    </ModalShell>
  );
}
