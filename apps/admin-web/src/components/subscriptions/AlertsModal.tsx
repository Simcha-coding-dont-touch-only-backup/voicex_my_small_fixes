import { useEffect, useState } from 'react';
import {
  ADMIN_ALERT_STATUSES,
  adminAlertTypeLabel,
  subscriptionAlertIssueLabel,
} from '@voicex/shared';
import { apiGet, apiPost, apiPatch } from '../../lib/api';
import { fmtDateTime, ModalShell } from './ui';

export function AlertsModal({
  subscriptionId,
  onClose,
  onChanged,
}: {
  subscriptionId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [week, setWeek] = useState(1);
  const [note, setNote] = useState('');
  const [ivr, setIvr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await apiGet<any>(`/subscriptions/${subscriptionId}/alerts`);
    setAlerts(res.data || []);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [subscriptionId]);

  const setStatus = async (id: string, status: string) => {
    await apiPatch(`/alerts/${id}`, { status });
    await load();
    onChanged();
  };

  const addAlert = async () => {
    setBusy(true);
    try {
      await apiPost(`/subscriptions/${subscriptionId}/alerts`, { week_number: week, admin_note: note, ivr_message: ivr });
      setAdding(false);
      setNote('');
      setIvr('');
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} wide>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Subscription Alerts</h3>
        <button className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'Add Alert'}
        </button>
      </div>

      {adding && (
        <div className="mb-4 space-y-2 rounded border bg-gray-50 p-3 text-sm">
          <p className="text-xs text-gray-500">Adds a Failed Delivery alert the customer will hear on their next call.</p>
          <label className="block">
            Week
            <select className="ml-2 rounded border px-2 py-1" value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10))}>
              {[1, 2, 3, 4].map((w) => <option key={w} value={w}>Week {w}</option>)}
            </select>
          </label>
          <textarea className="w-full rounded border px-2 py-1" placeholder="Admin note" value={note} onChange={(e) => setNote(e.target.value)} />
          <textarea className="w-full rounded border px-2 py-1" placeholder="IVR message (read to the customer)" value={ivr} onChange={(e) => setIvr(e.target.value)} />
          <button disabled={busy} className="rounded bg-green-600 px-3 py-1.5 text-white hover:bg-green-700" onClick={addAlert}>Create Alert</button>
        </div>
      )}

      <ul className="space-y-2 text-sm">
        {alerts.map((a) => {
          const payload = a.payload || {};
          return (
            <li key={a.id} className="rounded border px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{adminAlertTypeLabel(a.alert_type)}{payload.week_number ? ` · Week ${payload.week_number}` : ''}</span>
                <span className="text-xs text-gray-400">{fmtDateTime(a.created_at)}</span>
              </div>
              <div className="text-xs text-gray-500">
                {payload.issue_type ? subscriptionAlertIssueLabel(payload.issue_type) : (a.message || '')}
                {a.heard_at ? ' · Heard' : ' · Unheard'}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-gray-400">Status:</span>
                <select className="rounded border px-2 py-0.5 text-xs" value={a.status} onChange={(e) => setStatus(a.id, e.target.value)}>
                  {ADMIN_ALERT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </li>
          );
        })}
        {alerts.length === 0 && <li className="py-4 text-center text-gray-400">No alerts.</li>}
      </ul>

      <div className="mt-5 text-right">
        <button className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200" onClick={onClose}>Close</button>
      </div>
    </ModalShell>
  );
}
