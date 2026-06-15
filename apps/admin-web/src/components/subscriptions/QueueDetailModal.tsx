import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../../lib/api';
import { fmtDateTime, money, RunStatusBadge, ModalShell } from './ui';

export function QueueDetailModal({
  runId,
  onClose,
  onChanged,
}: {
  runId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await apiGet<any>(`/subscription-queue/${runId}`);
    setRun(res.data);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [runId]);

  const act = async (action: 'retry' | 'skip') => {
    setBusy(true);
    try {
      await apiPost(`/subscription-queue/${runId}/${action}`, {});
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (!run) return <ModalShell onClose={onClose}><p className="text-sm text-gray-500">Loading...</p></ModalShell>;

  const canAct = run.status === 'failed' || run.status === 'issue';
  return (
    <ModalShell onClose={onClose} wide>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Week {run.week_number} Delivery — {run.cycle_date}</h3>
        <RunStatusBadge status={run.status} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-gray-500">Customer:</span> {run.customer_name}</div>
        <div><span className="text-gray-500">Phone:</span> {run.phone || '-'}</div>
        <div><span className="text-gray-500">Email:</span> {run.email || '-'}</div>
        <div><span className="text-gray-500">Total:</span> {money(run.total_cents)}</div>
        <div><span className="text-gray-500">Processed:</span> {fmtDateTime(run.processed_at)}</div>
        <div>
          <span className="text-gray-500">Order:</span>{' '}
          {run.order_id ? <Link className="text-indigo-600 hover:underline" to={`/admin/orders/${run.order_id}`}>#{run.order_id}</Link> : '—'}
        </div>
        <div><span className="text-gray-500">Sola Txn:</span> {run.sola_transaction_id || '-'}</div>
        <div><span className="text-gray-500">Attempts:</span> {run.attempt_count}</div>
      </div>

      {run.issue_details && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <div className="font-semibold">Issue</div>
          <pre className="whitespace-pre-wrap break-words">{JSON.stringify(run.issue_details, null, 2)}</pre>
        </div>
      )}
      {run.failure_details && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <div className="font-semibold">Failure</div>
          <pre className="whitespace-pre-wrap break-words">{JSON.stringify(run.failure_details, null, 2)}</pre>
        </div>
      )}

      <h4 className="mt-4 mb-2 text-sm font-semibold">Items</h4>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-gray-500"><th className="py-1">Product</th><th>Qty</th><th>Orig</th><th>Price</th><th>Status</th></tr></thead>
        <tbody>
          {(run.items || []).map((it: any) => (
            <tr key={it.id} className="border-b">
              <td className="py-1">{it.product_name}</td>
              <td>{it.quantity}</td>
              <td>{it.original_quantity}</td>
              <td>{money(it.unit_price_cents)}</td>
              <td className="capitalize">{String(it.status).replace(/_/g, ' ')}{it.reason ? ` (${it.reason})` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="mt-4 mb-2 text-sm font-semibold">Attempt History</h4>
      <ul className="space-y-1 text-xs text-gray-600">
        {(run.events || []).map((ev: any) => (
          <li key={ev.id}>{fmtDateTime(ev.created_at)} — {String(ev.event_type).replace(/_/g, ' ')}</li>
        ))}
        {(run.events || []).length === 0 && <li className="text-gray-400">No attempts logged.</li>}
      </ul>

      <div className="mt-5 flex justify-end gap-2">
        {canAct && (
          <>
            <button disabled={busy} className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700" onClick={() => act('retry')}>Retry</button>
            <button disabled={busy} className="rounded bg-amber-500 px-4 py-2 text-sm text-white hover:bg-amber-600" onClick={() => act('skip')}>Skip</button>
          </>
        )}
        <button className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200" onClick={onClose}>Close</button>
      </div>
    </ModalShell>
  );
}
