import { useState } from 'react';
import { weekLabel } from '@voicex/shared';
import { apiPost } from '../../lib/api';
import { ModalShell } from './ui';

export function PauseModal({
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
  const [busy, setBusy] = useState(false);

  const pause = async (type: 'temporary' | 'permanent', cycles?: number) => {
    setBusy(true);
    try {
      await apiPost(`/subscriptions/deliveries/${deliveryId}/pause`, { type, cycles });
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <h3 className="mb-4 text-lg font-semibold">Pause {weekLabel(weekNumber)} Delivery</h3>
      <div className="space-y-2">
        <button disabled={busy} className="w-full rounded border px-4 py-2 text-left text-sm hover:bg-gray-50" onClick={() => pause('temporary', 1)}>
          Pause for the upcoming cycle (1 month)
        </button>
        <button disabled={busy} className="w-full rounded border px-4 py-2 text-left text-sm hover:bg-gray-50" onClick={() => pause('temporary', 3)}>
          Pause for the next 3 cycles (3 months)
        </button>
        <button disabled={busy} className="w-full rounded border px-4 py-2 text-left text-sm hover:bg-gray-50" onClick={() => pause('permanent')}>
          Pause permanently
        </button>
      </div>
      <div className="mt-4 text-right">
        <button className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200" onClick={onClose}>Cancel</button>
      </div>
    </ModalShell>
  );
}
