import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../lib/api';

interface TrashProduct {
  id: string;
  voicex_id: string;
  amazon_asin: string;
  amazon_name: string | null;
  voice_name: string | null;
  deleted_at: string;
  deleted_by_user: { id: string; email: string; name: string | null } | null;
}

function displayName(p: TrashProduct): string {
  return p.voice_name?.trim() || p.amazon_name?.trim() || 'Unknown Product';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function DeletedProductsPage() {
  const [products, setProducts] = useState<TrashProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmHardDelete, setConfirmHardDelete] = useState<TrashProduct[] | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiGet<{ data: TrashProduct[] }>('/catalog-trash/products')
      .then((r) => {
        setProducts(r.data || []);
        setSelected(new Set());
      })
      .catch((err) => setError(err.message || 'Failed to load deleted products'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const allSelected = products.length > 0 && selected.size === products.length;
  const selectedList = useMemo(
    () => products.filter((p) => selected.has(p.id)),
    [products, selected]
  );

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(products.map((p) => p.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const restore = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/catalog-trash/products/restore', { ids });
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to restore');
    } finally {
      setBusy(false);
    }
  };

  const hardDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete('/catalog-trash/products', { ids });
      setConfirmHardDelete(null);
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to permanently delete');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/products"
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft size={16} /> Back to Products
          </Link>
        </div>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Deleted Products</h2>
          <p className="mt-1 text-sm text-gray-500">
            Products deleted by sub-admins land here. Restore them to put them back into the live catalog,
            or permanently delete them to clear them out forever.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => restore(Array.from(selected))}
            disabled={busy || selected.size === 0}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RotateCcw size={16} /> Restore selected ({selected.size})
          </button>
          <button
            onClick={() => setConfirmHardDelete(selectedList)}
            disabled={busy || selected.size === 0}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 size={16} /> Delete permanently ({selected.size})
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={products.length === 0}
                />
              </th>
              <th className="px-4 py-3 font-medium">VoiceX ID</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">ASIN</th>
              <th className="px-4 py-3 font-medium">Deleted at</th>
              <th className="px-4 py-3 font-medium">Deleted by</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading...</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No deleted products.</td></tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleOne(p.id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{p.voicex_id}</td>
                  <td className="px-4 py-3 text-gray-900">{displayName(p)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.amazon_asin}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(p.deleted_at)}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {p.deleted_by_user
                      ? p.deleted_by_user.name || p.deleted_by_user.email
                      : <span className="text-gray-400">unknown</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => restore([p.id])}
                        disabled={busy}
                        className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <RotateCcw size={12} /> Restore
                      </button>
                      <button
                        onClick={() => setConfirmHardDelete([p])}
                        disabled={busy}
                        className="flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        <Trash2 size={12} /> Delete forever
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {confirmHardDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Permanently delete?</h3>
            </div>
            <p className="mb-4 text-sm text-gray-600">
              This will <span className="font-medium text-red-700">permanently delete</span>{' '}
              {confirmHardDelete.length === 1
                ? <>the product <span className="font-medium text-gray-900">"{displayName(confirmHardDelete[0])}"</span></>
                : <><span className="font-medium text-gray-900">{confirmHardDelete.length} products</span></>
              }. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmHardDelete(null)}
                disabled={busy}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => hardDelete(confirmHardDelete.map((p) => p.id))}
                disabled={busy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Deleting...' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
