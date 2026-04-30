import { useEffect, useState } from 'react';
import { apiPut } from '../lib/api';

export interface EtaFormRow {
  eta_date: string;
}

interface OrderEtaEditorProps {
  orderId: string;
  value: EtaFormRow[];
  onChange: (rows: EtaFormRow[]) => void;
  onSaved?: (order: any) => void;
  disabled?: boolean;
}

interface EtaResponse {
  success: boolean;
  data: any;
}

function toDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '';
}

export function normalizeEtaRows(etas: any[] | null | undefined): EtaFormRow[] {
  return [...(etas || [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((eta) => ({ eta_date: toDateInput(eta.eta_date) }));
}

export function serializeEtaRows(rows: EtaFormRow[]) {
  return rows.map((row) => ({ eta_date: row.eta_date })).filter((row) => row.eta_date);
}

export function OrderEtaEditor({ orderId, value, onChange, onSaved, disabled }: OrderEtaEditorProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
  }, [orderId]);

  const updateRow = (index: number, etaDate: string) => {
    onChange(value.map((row, rowIndex) => rowIndex === index ? { eta_date: etaDate } : row));
  };

  const removeRow = (index: number) => {
    onChange(value.filter((_, rowIndex) => rowIndex !== index));
  };

  const saveEtas = async () => {
    setError('');
    if (value.some((row) => !row.eta_date)) {
      setError('Choose a date for each ETA, or remove the blank ETA row.');
      return;
    }

    setSaving(true);
    try {
      const response = await apiPut<EtaResponse>(`/orders/${orderId}/etas`, {
        etas: serializeEtaRows(value),
      });
      onChange(normalizeEtaRows(response.data?.order_fulfillment_etas));
      onSaved?.(response.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to save ETAs');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Arrival ETAs</h4>
          <p className="text-xs text-gray-400">Used by the phone order status flow.</p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...value, { eta_date: '' }])}
          disabled={disabled || saving}
          className="rounded border px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Add ETA
        </button>
      </div>

      {value.length === 0 ? (
        <p className="text-xs text-gray-400">No ETA dates saved.</p>
      ) : (
        <div className="space-y-2">
          {value.map((row, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="date"
                value={row.eta_date}
                onChange={(e) => updateRow(index, e.target.value)}
                disabled={disabled || saving}
                className="min-w-0 flex-1 rounded border px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => removeRow(index)}
                disabled={disabled || saving}
                className="rounded border px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <button
        type="button"
        onClick={saveEtas}
        disabled={disabled || saving}
        className="mt-3 rounded bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save ETAs'}
      </button>
    </div>
  );
}
