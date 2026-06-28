import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { apiGet } from '../lib/api';
import { amazonAvailabilityStatusLabel, type ProductHistoryEntry } from '@voicex/shared';

function formatPrice(value: string | null): string {
  if (value == null || value === '') return 'N/A';
  const cents = Number(value);
  if (!Number.isFinite(cents)) return value;
  return `$${(cents / 100).toFixed(2)}`;
}

function priceChangeColor(oldValue: string | null, newValue: string | null): string {
  if (oldValue == null || oldValue === '' || newValue == null || newValue === '') {
    return 'text-gray-700';
  }
  const oldNum = Number(oldValue);
  const newNum = Number(newValue);
  if (!Number.isFinite(oldNum) || !Number.isFinite(newNum) || oldNum === newNum) {
    return 'text-gray-700';
  }
  return newNum < oldNum ? 'text-green-600' : 'text-red-600';
}

function changeTypeLabel(changeType: ProductHistoryEntry['change_type']): string {
  if (changeType === 'price') return 'Price';
  if (changeType === 'amazon_availability') return 'Amazon availability';
  return 'Status';
}

function changeTypeBadgeClass(changeType: ProductHistoryEntry['change_type']): string {
  if (changeType === 'price') return 'bg-indigo-100 text-indigo-700';
  if (changeType === 'amazon_availability') return 'bg-rose-100 text-rose-700';
  return 'bg-amber-100 text-amber-700';
}

function actorLabel(entry: ProductHistoryEntry): string {
  if (entry.actor_kind === 'system') return 'System';
  if (entry.actor_kind === 'checkout') return 'Checkout';
  return entry.actor_label || 'Admin';
}

export function ProductHistoryModal({
  productId,
  productName,
  onClose,
}: {
  productId: string;
  productName: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<ProductHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGet<{ data: ProductHistoryEntry[] }>(`/catalog/products/${productId}/history`)
      .then((res) => {
        if (!active) return;
        setEntries(res.data || []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || 'Failed to load history');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Change History</h3>
            <p className="text-xs text-gray-400">{productName}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="animate-spin" size={20} />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">No changes recorded yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Change</th>
                  <th className="py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 text-gray-600">{new Date(e.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${changeTypeBadgeClass(e.change_type)}`}>
                        {changeTypeLabel(e.change_type)}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {e.change_type === 'price' ? (
                        <span>
                          {formatPrice(e.old_value)} <span className="text-gray-400">&rarr;</span>{' '}
                          <span className={priceChangeColor(e.old_value, e.new_value)}>
                            {formatPrice(e.new_value)}
                          </span>
                        </span>
                      ) : e.change_type === 'amazon_availability' ? (
                        <span>
                          {amazonAvailabilityStatusLabel(e.old_value)} <span className="text-gray-400">&rarr;</span>{' '}
                          {amazonAvailabilityStatusLabel(e.new_value)}
                        </span>
                      ) : (
                        <span>
                          {e.old_value ?? 'N/A'} <span className="text-gray-400">&rarr;</span> {e.new_value ?? 'N/A'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-gray-600">{actorLabel(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
