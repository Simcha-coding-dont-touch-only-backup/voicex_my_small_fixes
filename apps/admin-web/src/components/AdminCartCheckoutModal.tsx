import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../lib/api';
import { ModalShell } from './subscriptions/ui';
import { CardFormFields, emptyCardForm, type CardForm, type CardSavePayload } from './CardFormFields';

interface AddressRow {
  id: string;
  label: string | null;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  is_default: boolean;
}

interface PaymentMethodRow {
  id: string;
  card_last4: string;
  card_brand: string | null;
  card_exp_month: number;
  card_exp_year: number;
  is_default: boolean;
}

interface RecheckData {
  cartId: string;
  userId: string;
  checkedCount: number;
  changedCount: number;
  unavailable: Array<{ cartItemId: string; productId: string; productName: string }>;
  priceChanges: Array<{
    cartItemId: string;
    productId: string;
    productName: string;
    oldUnitPriceCents: number;
    newUnitPriceCents: number;
    direction: 'up' | 'down';
  }>;
  stale: Array<{ cartItemId: string; productId: string; productName: string; reason: string }>;
  unverifiedCount: number;
  runId: string | null;
  hasChanges: boolean;
  subtotalCents: number;
  pricedLines: Array<{
    cartItemId: string;
    productName: string;
    quantity: number;
    unitPriceCents: number | null;
  }>;
  addresses: AddressRow[];
  paymentMethods: PaymentMethodRow[];
}

interface PricingPreview {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

const money = (cents: number | null | undefined) =>
  cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;

const emptyAddressForm = {
  label: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  zip_code: '',
  country: 'US',
  is_default: false,
};

export function AdminCartCheckoutModal({
  cartId,
  userName,
  onClose,
  onComplete,
}: {
  cartId: string;
  userName: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recheck, setRecheck] = useState<RecheckData | null>(null);
  const [addressId, setAddressId] = useState('');
  const [cardId, setCardId] = useState('');
  const [addingAddress, setAddingAddress] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [cardFormKey, setCardFormKey] = useState(0);
  const [addressForm, setAddressForm] = useState(emptyAddressForm);
  const [cardForm, setCardForm] = useState<CardForm>(emptyCardForm);
  const [savingAddress, setSavingAddress] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [pricing, setPricing] = useState<PricingPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);

  const runRecheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiPost<any>(`/carts/${cartId}/checkout/recheck`, {});
      if (!res?.success) throw new Error(res?.error || 'Re-check failed');
      const d = res.data as RecheckData;
      setRecheck(d);
      const defaultAddr = d.addresses.find((a) => a.is_default) || d.addresses[0];
      const defaultCard = d.paymentMethods.find((c) => c.is_default) || d.paymentMethods[0];
      setAddressId(defaultAddr?.id || '');
      setCardId(defaultCard?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to re-check cart');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runRecheck();
  }, [cartId]);

  useEffect(() => {
    if (!addressId || !recheck) {
      setPricing(null);
      return;
    }
    void (async () => {
      try {
        const res = await apiPost<any>(`/carts/${cartId}/checkout/preview`, { address_id: addressId });
        if (res?.success && res.data) {
          setPricing({
            subtotalCents: res.data.subtotalCents,
            shippingCents: res.data.shippingCents,
            taxCents: res.data.taxCents,
            totalCents: res.data.totalCents,
          });
        }
      } catch {
        setPricing(null);
      }
    })();
  }, [addressId, cartId, recheck]);

  const refreshPaymentMethods = async (userId: string) => {
    const res = await apiGet<any>(`/users/${userId}`);
    const cards = (res?.data?.payment_methods || []).filter((c: any) => c.is_verified);
    if (recheck) {
      setRecheck({ ...recheck, paymentMethods: cards });
    }
    return cards;
  };

  const handleAddAddress = async () => {
    if (!recheck) return;
    if (!addressForm.address1 || !addressForm.city || !addressForm.state || !addressForm.zip_code) {
      alert('Address line 1, city, state, and ZIP are required');
      return;
    }
    setSavingAddress(true);
    try {
      const res = await apiPost<any>(`/users/${recheck.userId}/addresses`, addressForm);
      const addr = res?.data;
      if (!addr) throw new Error('Failed to save address');
      setRecheck({
        ...recheck,
        addresses: [addr, ...recheck.addresses.map((a) => ({ ...a, is_default: false }))],
      });
      setAddressId(addr.id);
      setAddingAddress(false);
      setAddressForm(emptyAddressForm);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save address');
    } finally {
      setSavingAddress(false);
    }
  };

  const handleAddCard = async (payload: CardSavePayload) => {
    if (!recheck) return;
    setSavingCard(true);
    try {
      const res = await apiPost<any>(`/users/${recheck.userId}/payment-methods`, payload);
      const card = res?.data;
      if (!card) throw new Error('Failed to save card');
      const cards = await refreshPaymentMethods(recheck.userId);
      const saved = cards.find((c: PaymentMethodRow) => c.id === card.id) || card;
      setCardId(saved.id);
      setAddingCard(false);
      setCardForm(emptyCardForm);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save card');
      throw e;
    } finally {
      setSavingCard(false);
    }
  };

  const handleConfirm = async () => {
    if (!recheck || !addressId || !cardId) {
      alert('Select an address and payment method');
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      const res = await apiPost<any>(`/carts/${cartId}/checkout/confirm`, {
        address_id: addressId,
        payment_method_id: cardId,
        run_id: recheck.runId,
      });
      if (!res?.success) throw new Error(res?.error || 'Checkout failed');
      setOrderId(res.data.order_id);
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setConfirming(false);
    }
  };

  if (orderId) {
    return (
      <ModalShell onClose={onClose}>
        <h3 className="mb-2 text-lg font-semibold text-green-700">Order placed</h3>
        <p className="text-sm text-gray-600">
          Checkout completed for {userName}. Order{' '}
          <Link className="text-indigo-600 hover:underline" to={`/admin/orders/${orderId}`}>
            #{orderId}
          </Link>{' '}
          is in the manual fulfillment queue.
        </p>
        <div className="mt-4 text-right">
          <button
            type="button"
            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} wide>
      <h3 className="mb-1 text-lg font-semibold">Admin Cart Checkout</h3>
      <p className="mb-4 text-sm text-gray-500">{userName}</p>

      {loading && <p className="text-sm text-gray-500">Re-checking products with Rainforest...</p>}

      {error && !loading && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {recheck && !loading && (
        <div className="space-y-5">
          <section className="rounded-lg border bg-gray-50 p-4">
            <h4 className="text-sm font-semibold text-gray-800">Price re-check</h4>
            <p className="mt-1 text-sm text-gray-600">
              {recheck.changedCount} changed · {recheck.checkedCount} checked
              {recheck.unverifiedCount > 0 ? ` · ${recheck.unverifiedCount} unverified` : ''}
            </p>

            {(recheck.priceChanges.length > 0 || recheck.stale.length > 0 || recheck.unavailable.length > 0) && (
              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="pb-1 pr-3 font-medium">Product</th>
                    <th className="pb-1 pr-3 font-medium">Was</th>
                    <th className="pb-1 pr-3 font-medium">Now</th>
                    <th className="pb-1 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {recheck.priceChanges.map((item) => (
                    <tr key={item.cartItemId} className="text-gray-700">
                      <td className="py-0.5 pr-3">{item.productName}</td>
                      <td className="py-0.5 pr-3">{money(item.oldUnitPriceCents)}</td>
                      <td className="py-0.5 pr-3">{money(item.newUnitPriceCents)}</td>
                      <td className={`py-0.5 ${item.direction === 'up' ? 'text-red-600' : 'text-green-600'}`}>
                        {item.direction === 'up' ? 'Price up' : 'Price down'}
                      </td>
                    </tr>
                  ))}
                  {recheck.stale.map((item) => (
                    <tr key={item.cartItemId} className="text-amber-700">
                      <td className="py-0.5 pr-3">{item.productName}</td>
                      <td colSpan={3} className="py-0.5">Not verified — {item.reason}</td>
                    </tr>
                  ))}
                  {recheck.unavailable.map((item) => (
                    <tr key={item.cartItemId} className="text-gray-500">
                      <td className="py-0.5 pr-3">{item.productName}</td>
                      <td colSpan={3} className="py-0.5">Removed — no longer available</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-800">Shipping address</h4>
            {!addingAddress ? (
              <>
                <select
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={addressId}
                  onChange={(e) => setAddressId(e.target.value)}
                >
                  <option value="">Select a saved address</option>
                  {recheck.addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.address1}, {a.city}, {a.state} {a.zip_code}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-sm text-indigo-600 hover:underline"
                  onClick={() => setAddingAddress(true)}
                >
                  + Add new address
                </button>
              </>
            ) : (
              <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    placeholder="Label"
                    value={addressForm.label}
                    onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })}
                    className="rounded border px-2 py-1.5"
                  />
                  <input
                    placeholder="Country"
                    value={addressForm.country}
                    onChange={(e) => setAddressForm({ ...addressForm, country: e.target.value })}
                    className="rounded border px-2 py-1.5"
                  />
                </div>
                <input
                  placeholder="Address line 1 *"
                  value={addressForm.address1}
                  onChange={(e) => setAddressForm({ ...addressForm, address1: e.target.value })}
                  className="w-full rounded border px-2 py-1.5"
                />
                <input
                  placeholder="Address line 2"
                  value={addressForm.address2}
                  onChange={(e) => setAddressForm({ ...addressForm, address2: e.target.value })}
                  className="w-full rounded border px-2 py-1.5"
                />
                <div className="grid grid-cols-3 gap-2">
                  <input
                    placeholder="City *"
                    value={addressForm.city}
                    onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                    className="rounded border px-2 py-1.5"
                  />
                  <input
                    placeholder="State *"
                    value={addressForm.state}
                    onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value })}
                    className="rounded border px-2 py-1.5"
                  />
                  <input
                    placeholder="ZIP *"
                    value={addressForm.zip_code}
                    onChange={(e) => setAddressForm({ ...addressForm, zip_code: e.target.value })}
                    className="rounded border px-2 py-1.5"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={savingAddress}
                    onClick={handleAddAddress}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingAddress ? 'Saving...' : 'Save address'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingAddress(false)}
                    className="rounded border px-3 py-1.5 text-sm text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-800">Payment method</h4>
            {!addingCard ? (
              <>
                <select
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={cardId}
                  onChange={(e) => setCardId(e.target.value)}
                >
                  <option value="">Select a saved card</option>
                  {recheck.paymentMethods.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.card_brand || 'Card'} ending in {c.card_last4}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-sm text-indigo-600 hover:underline"
                  onClick={() => {
                    setCardForm(emptyCardForm);
                    setCardFormKey((k) => k + 1);
                    setAddingCard(true);
                  }}
                >
                  + Add new card
                </button>
              </>
            ) : (
              <CardFormFields
                key={cardFormKey}
                form={cardForm}
                onChange={setCardForm}
                onSave={handleAddCard}
                onCancel={() => setAddingCard(false)}
                saving={savingCard}
              />
            )}
          </section>

          {pricing && (
            <section className="rounded-lg border bg-white p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span>{money(pricing.subtotalCents)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-gray-500">Shipping</span>
                <span>{money(pricing.shippingCents)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-gray-500">Tax</span>
                <span>{money(pricing.taxCents)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
                <span>Total (auth hold)</span>
                <span>{money(pricing.totalCents)}</span>
              </div>
            </section>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={confirming || !addressId || !cardId}
              onClick={handleConfirm}
              className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {confirming ? 'Placing order...' : 'Place order'}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
