import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '../../lib/api';
import { ModalShell } from './ui';

export function CheckoutModal({
  subscriptionId,
  onClose,
  onChanged,
}: {
  subscriptionId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [addressId, setAddressId] = useState('');
  const [cardId, setCardId] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiGet<any>(`/subscriptions/${subscriptionId}/checkout`);
        const d = res?.data;
        if (!d) throw new Error('Unexpected response from server');
        setData(d);
        setAddressId(d.subscription?.subscription_address_id || '');
        setCardId(d.subscription?.payment_method_id || '');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load checkout details');
      }
    })();
  }, [subscriptionId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/subscriptions/${subscriptionId}/checkout`, {
        address_id: addressId || null,
        payment_method_id: cardId || null,
      });
      setEditing(false);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save checkout details');
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <ModalShell onClose={onClose}>
        <p className="text-sm text-red-600">{error}</p>
        <div className="mt-4 text-right">
          <button className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200" onClick={onClose}>Close</button>
        </div>
      </ModalShell>
    );
  }

  if (!data) {
    return <ModalShell onClose={onClose}><p className="text-sm text-gray-500">Loading...</p></ModalShell>;
  }

  const addr = data.address;
  return (
    <ModalShell onClose={onClose}>
      <h3 className="mb-4 text-lg font-semibold">Subscription Checkout</h3>

      {!editing ? (
        <div className="space-y-4 text-sm">
          <div>
            <div className="text-xs uppercase text-gray-500">Address</div>
            <div>{addr ? `${addr.address1}, ${addr.city}, ${addr.state} ${addr.zip_code}` : 'Not set'}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500">Card</div>
            <div>{data.card ? `${data.card.card_brand || 'Card'} ending in ${data.card.card_last4}` : 'Not set'}</div>
          </div>
          <button className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700" onClick={() => setEditing(true)}>Edit</button>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <label className="block">
            <span className="text-xs uppercase text-gray-500">Address</span>
            <select className="mt-1 w-full rounded border px-3 py-2" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
              <option value="">Select a saved address</option>
              {(data.addresses || []).map((a: any) => (
                <option key={a.id} value={a.id}>{a.address1}, {a.city}, {a.state} {a.zip_code}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase text-gray-500">Card</span>
            <select className="mt-1 w-full rounded border px-3 py-2" value={cardId} onChange={(e) => setCardId(e.target.value)}>
              <option value="">Select a saved card</option>
              {(data.cards || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.card_brand || 'Card'} ending in {c.card_last4}</option>
              ))}
            </select>
          </label>
          <p className="text-xs text-gray-400">To add a new card or address, add it on the customer's user page, then select it here.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button disabled={busy} className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700" onClick={save}>Save</button>
            <button className="rounded bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
