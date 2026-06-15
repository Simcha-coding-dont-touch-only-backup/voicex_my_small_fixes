import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiGet, apiPatch, apiPost, apiDelete } from '../lib/api';

interface AddressForm {
  label: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  is_default: boolean;
}

const emptyAddress: AddressForm = {
  label: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  zip_code: '',
  country: 'US',
  is_default: false,
};

interface CardForm {
  card_number: string;
  exp_month: string;
  exp_year: string;
  cvv: string;
  zip: string;
  is_default: boolean;
}

const emptyCard: CardForm = {
  card_number: '',
  exp_month: '',
  exp_year: '',
  cvv: '',
  zip: '',
  is_default: false,
};

function ConfirmDialog({
  open,
  title,
  message,
  warning,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  message: string;
  warning?: string | null;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        {warning && (
          <div className="mt-3 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 flex-shrink-0">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <span>{warning}</span>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded border px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded bg-red-600 px-4 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CardFormFields({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  form: CardForm;
  onChange: (f: CardForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
      <div>
        <label className="text-xs font-medium text-gray-600">Card Number *</label>
        <input
          value={form.card_number}
          onChange={(e) =>
            onChange({ ...form, card_number: e.target.value.replace(/[^0-9 ]/g, '').slice(0, 23) })
          }
          placeholder="4242 4242 4242 4242"
          inputMode="numeric"
          autoComplete="off"
          className="mt-1 w-full rounded border px-3 py-1.5 font-mono text-sm"
        />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600">Exp Month *</label>
          <input
            value={form.exp_month}
            onChange={(e) =>
              onChange({ ...form, exp_month: e.target.value.replace(/\D/g, '').slice(0, 2) })
            }
            placeholder="MM"
            inputMode="numeric"
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Exp Year *</label>
          <input
            value={form.exp_year}
            onChange={(e) =>
              onChange({ ...form, exp_year: e.target.value.replace(/\D/g, '').slice(0, 4) })
            }
            placeholder="YYYY"
            inputMode="numeric"
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">CVV</label>
          <input
            value={form.cvv}
            onChange={(e) =>
              onChange({ ...form, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })
            }
            placeholder="123"
            inputMode="numeric"
            autoComplete="off"
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Billing ZIP</label>
          <input
            value={form.zip}
            onChange={(e) =>
              onChange({ ...form, zip: e.target.value.replace(/\D/g, '').slice(0, 10) })
            }
            placeholder="12345"
            inputMode="numeric"
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.is_default}
          onChange={(e) => onChange({ ...form, is_default: e.target.checked })}
        />
        Default card
      </label>
      <p className="text-xs text-gray-500">
        Card data is sent directly to Sola for tokenization and is never stored on our servers.
      </p>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Card'}
        </button>
        <button
          onClick={onCancel}
          className="rounded border px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddressFormFields({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  form: AddressForm;
  onChange: (f: AddressForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600">Label</label>
          <input
            value={form.label}
            onChange={(e) => onChange({ ...form, label: e.target.value })}
            placeholder="e.g. Home, Work"
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Country</label>
          <input
            value={form.country}
            onChange={(e) => onChange({ ...form, country: e.target.value })}
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">Address Line 1 *</label>
        <input
          value={form.address1}
          onChange={(e) => onChange({ ...form, address1: e.target.value })}
          className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">Address Line 2</label>
        <input
          value={form.address2}
          onChange={(e) => onChange({ ...form, address2: e.target.value })}
          placeholder="Apt, Suite, etc."
          className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600">City *</label>
          <input
            value={form.city}
            onChange={(e) => onChange({ ...form, city: e.target.value })}
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">State *</label>
          <input
            value={form.state}
            onChange={(e) => onChange({ ...form, state: e.target.value })}
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">ZIP *</label>
          <input
            value={form.zip_code}
            onChange={(e) => onChange({ ...form, zip_code: e.target.value })}
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.is_default}
          onChange={(e) => onChange({ ...form, is_default: e.target.checked })}
        />
        Default address
      </label>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="rounded border px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loginHistory, setLoginHistory] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', status: '', is_whitelisted: false });
  const [newPin, setNewPin] = useState('');

  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressForm, setAddressForm] = useState<AddressForm>(emptyAddress);
  const [addingAddress, setAddingAddress] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);

  const [addingCard, setAddingCard] = useState(false);
  const [cardForm, setCardForm] = useState<CardForm>(emptyCard);
  const [savingCard, setSavingCard] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    warning?: string | null;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const refreshUser = () =>
    apiGet<any>(`/users/${id}`).then((res) => {
      setUser(res.data);
      setForm({
        name: res.data.name,
        email: res.data.email || '',
        status: res.data.status,
        is_whitelisted: res.data.is_whitelisted,
      });
    });

  useEffect(() => {
    const load = async () => {
      await refreshUser();
      const res = await apiGet<any>(`/users/${id}/login-history`);
      setLoginHistory(res.data || []);
    };
    load();
  }, [id]);

  const handleSave = async () => {
    await apiPatch(`/users/${id}`, form);
    await refreshUser();
    setEditing(false);
  };

  const handleResetPin = async () => {
    if (newPin.length !== 4) return alert('PIN must be 4 digits');
    await apiPatch(`/users/${id}/pin`, { pin: newPin });
    setNewPin('');
    alert('PIN updated');
  };

  const startEditAddress = (addr: any) => {
    setEditingAddressId(addr.id);
    setAddingAddress(false);
    setAddressForm({
      label: addr.label || '',
      address1: addr.address1,
      address2: addr.address2 || '',
      city: addr.city,
      state: addr.state,
      zip_code: addr.zip_code,
      country: addr.country,
      is_default: addr.is_default,
    });
  };

  const handleSaveAddress = async () => {
    if (!addressForm.address1 || !addressForm.city || !addressForm.state || !addressForm.zip_code) {
      alert('Address line 1, city, state, and ZIP are required');
      return;
    }
    setSavingAddress(true);
    try {
      if (addingAddress) {
        await apiPost(`/users/${id}/addresses`, addressForm);
      } else if (editingAddressId) {
        await apiPatch(`/users/${id}/addresses/${editingAddressId}`, addressForm);
      }
      setEditingAddressId(null);
      setAddingAddress(false);
      setAddressForm(emptyAddress);
      await refreshUser();
    } catch (err: any) {
      alert(err.message || 'Failed to save address');
    } finally {
      setSavingAddress(false);
    }
  };

  const handleDeleteAddress = (addr: any) => {
    const summary = `${addr.address1}, ${addr.city}, ${addr.state} ${addr.zip_code}`;
    setConfirmState({
      title: 'Delete address?',
      message: `This will permanently remove "${summary}" from this user. This cannot be undone.`,
      onConfirm: async () => {
        try {
          await apiDelete(`/users/${id}/addresses/${addr.id}`);
          await refreshUser();
        } catch (err: any) {
          alert(err.message || 'Failed to delete address');
        }
      },
    });
  };

  const cancelAddressEdit = () => {
    setEditingAddressId(null);
    setAddingAddress(false);
    setAddressForm(emptyAddress);
  };

  const handleSaveCard = async () => {
    const cleanNum = cardForm.card_number.replace(/\D/g, '');
    if (cleanNum.length < 13 || cleanNum.length > 19) {
      alert('Card number must be 13-19 digits');
      return;
    }
    const m = parseInt(cardForm.exp_month, 10);
    if (!m || m < 1 || m > 12) {
      alert('Expiration month must be 01-12');
      return;
    }
    let y = parseInt(cardForm.exp_year, 10);
    if (!y) {
      alert('Expiration year is required');
      return;
    }
    if (y < 100) y = 2000 + y;

    setSavingCard(true);
    try {
      await apiPost(`/users/${id}/payment-methods`, {
        card_number: cleanNum,
        exp_month: m,
        exp_year: y,
        cvv: cardForm.cvv || undefined,
        zip: cardForm.zip || undefined,
        is_default: cardForm.is_default,
      });
      setAddingCard(false);
      setCardForm(emptyCard);
      await refreshUser();
    } catch (err: any) {
      alert(err.message || 'Failed to save card');
    } finally {
      setSavingCard(false);
    }
  };

  const handleSetDefaultCard = async (cardId: string) => {
    try {
      await apiPatch(`/users/${id}/payment-methods/${cardId}`, { is_default: true });
      await refreshUser();
    } catch (err: any) {
      alert(err.message || 'Failed to update card');
    }
  };

  const handleDeleteCard = async (card: any) => {
    const label = `${card.card_brand || 'Card'} ending in ${card.card_last4}`;

    let warning: string | null = null;
    try {
      const usage = await apiGet<{ data: { active_order_count: number } }>(
        `/users/${id}/payment-methods/${card.id}/usage`
      );
      const active = usage.data.active_order_count;
      if (active > 0) {
        warning =
          active === 1
            ? 'There is 1 active order on this card (not yet completed, failed, or cancelled). Deleting now means you cannot re-charge or re-authorize that order with this card if needed.'
            : `There are ${active} active orders on this card (not yet completed, failed, or cancelled). Deleting now means you cannot re-charge or re-authorize those orders with this card if needed.`;
      }
    } catch {
      // Usage check is advisory only; never block the delete flow on it.
    }

    setConfirmState({
      title: 'Delete saved card?',
      message: `This will permanently remove ${label} from this user. Past orders will keep showing the card brand and last 4 digits, but the card itself can no longer be charged.`,
      warning,
      onConfirm: async () => {
        try {
          await apiDelete(`/users/${id}/payment-methods/${card.id}`);
          await refreshUser();
        } catch (err: any) {
          alert(err.message || 'Failed to delete card');
        }
      },
    });
  };

  const cancelCardAdd = () => {
    setAddingCard(false);
    setCardForm(emptyCard);
  };

  if (!user) return <div className="text-gray-500">Loading...</div>;

  const addresses: any[] = user.addresses || [];
  const cards: any[] = user.payment_methods || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/admin/users')} className="text-sm text-indigo-600 hover:underline">&larr; Back</button>
        <h2 className="text-2xl font-bold text-gray-800">{user.name}</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Profile</h3>
            <button onClick={() => setEditing(!editing)} className="text-sm text-indigo-600 hover:underline">
              {editing ? 'Cancel' : 'Edit'}
            </button>
          </div>

          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-600">Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Email</label>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm">
                  <option value="active">Active</option>
                  <option value="frozen">Frozen</option>
                  <option value="deleted">Deleted</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_whitelisted}
                  onChange={(e) => setForm({ ...form, is_whitelisted: e.target.checked })} />
                Whitelisted (no markup)
              </label>
              <button onClick={handleSave} className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
                Save
              </button>
            </div>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2"><dt className="font-medium text-gray-500 w-28">Name</dt><dd>{user.name}</dd></div>
              <div className="flex gap-2"><dt className="font-medium text-gray-500 w-28">Email</dt><dd>{user.email || '-'}</dd></div>
              <div className="flex gap-2"><dt className="font-medium text-gray-500 w-28">Status</dt><dd>{user.status}</dd></div>
              <div className="flex gap-2"><dt className="font-medium text-gray-500 w-28">Whitelisted</dt><dd>{user.is_whitelisted ? 'Yes' : 'No'}</dd></div>
              <div className="flex gap-2"><dt className="font-medium text-gray-500 w-28">Phone(s)</dt><dd>{user.user_phones?.map((p: any) => p.phone_number).join(', ') || '-'}</dd></div>
              <div className="flex gap-2"><dt className="font-medium text-gray-500 w-28">Addresses</dt><dd>{addresses.length}</dd></div>
              <div className="flex gap-2"><dt className="font-medium text-gray-500 w-28">Cards</dt><dd>{user.payment_methods?.length || 0}</dd></div>
              <div className="flex gap-2">
                <dt className="font-medium text-gray-500 w-28">Subscription</dt>
                <dd>
                  {(user.subscription_count ?? 0) > 0 ? (
                    <Link to="/admin/subscriptions" className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 hover:ring-2 hover:ring-indigo-200">
                      {user.subscription_count} active {user.subscription_count === 1 ? 'delivery' : 'deliveries'}
                    </Link>
                  ) : '0'}
                </dd>
              </div>
              <div className="flex gap-2"><dt className="font-medium text-gray-500 w-28">Joined</dt><dd>{new Date(user.created_at).toLocaleString()}</dd></div>
            </dl>
          )}

          <div className="mt-6 border-t pt-4">
            <h4 className="mb-2 text-sm font-semibold text-gray-700">Reset PIN</h4>
            <div className="flex gap-2">
              <input value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4 digits" maxLength={4}
                className="w-28 rounded border px-3 py-2 text-sm" />
              <button onClick={handleResetPin} className="rounded bg-orange-500 px-4 py-2 text-sm text-white hover:bg-orange-600">
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Addresses ({addresses.length})</h3>
              {!addingAddress && !editingAddressId && (
                <button
                  onClick={() => {
                    setAddingAddress(true);
                    setEditingAddressId(null);
                    setAddressForm(emptyAddress);
                  }}
                  className="text-sm text-indigo-600 hover:underline"
                >
                  + Add
                </button>
              )}
            </div>

            {addingAddress && (
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-gray-700">New Address</p>
                <AddressFormFields
                  form={addressForm}
                  onChange={setAddressForm}
                  onSave={handleSaveAddress}
                  onCancel={cancelAddressEdit}
                  saving={savingAddress}
                />
              </div>
            )}

            {addresses.length === 0 && !addingAddress && (
              <p className="text-sm text-gray-400">No addresses on file</p>
            )}

            <div className="space-y-3">
              {addresses.map((addr: any) =>
                editingAddressId === addr.id ? (
                  <AddressFormFields
                    key={addr.id}
                    form={addressForm}
                    onChange={setAddressForm}
                    onSave={handleSaveAddress}
                    onCancel={cancelAddressEdit}
                    saving={savingAddress}
                  />
                ) : (
                  <div
                    key={addr.id}
                    className="flex items-start justify-between rounded-lg border p-3"
                  >
                    <div className="text-sm">
                      <div className="flex items-center gap-2">
                        {addr.label && (
                          <span className="font-medium text-gray-800">{addr.label}</span>
                        )}
                        {addr.is_default && (
                          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                            Default
                          </span>
                        )}
                        {addr.is_validated && (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                            Verified
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600">
                        {addr.address1}
                        {addr.address2 ? `, ${addr.address2}` : ''}
                      </p>
                      <p className="text-gray-600">
                        {addr.city}, {addr.state} {addr.zip_code}
                      </p>
                      {addr.country !== 'US' && (
                        <p className="text-gray-500">{addr.country}</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => startEditAddress(addr)}
                        title="Edit address"
                        aria-label="Edit address"
                        className="rounded p-1.5 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.886L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteAddress(addr)}
                        title="Delete address"
                        aria-label="Delete address"
                        className="rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Saved Cards ({cards.length})</h3>
              {!addingCard && (
                <button
                  onClick={() => {
                    setAddingCard(true);
                    setCardForm(emptyCard);
                  }}
                  className="text-sm text-indigo-600 hover:underline"
                >
                  + Add
                </button>
              )}
            </div>

            {addingCard && (
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-gray-700">New Card</p>
                <CardFormFields
                  form={cardForm}
                  onChange={setCardForm}
                  onSave={handleSaveCard}
                  onCancel={cancelCardAdd}
                  saving={savingCard}
                />
              </div>
            )}

            {cards.length === 0 && !addingCard && (
              <p className="text-sm text-gray-400">No cards on file</p>
            )}

            <div className="space-y-3">
              {cards.map((card: any) => (
                <div
                  key={card.id}
                  className="flex items-start justify-between rounded-lg border p-3"
                >
                  <div className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">
                        {card.card_brand || 'Card'} •••• {card.card_last4}
                      </span>
                      {card.is_default && (
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600">
                      Expires {String(card.card_exp_month).padStart(2, '0')}/{card.card_exp_year}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {!card.is_default && (
                      <button
                        onClick={() => handleSetDefaultCard(card.id)}
                        title="Set as default"
                        aria-label="Set as default"
                        className="rounded p-1.5 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.4z" clipRule="evenodd" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteCard(card)}
                      title="Delete card"
                      aria-label="Delete card"
                      className="rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold">Login History</h3>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Phone</th>
                    <th className="pb-2 font-medium">Result</th>
                    <th className="pb-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {loginHistory.map((ev) => (
                    <tr key={ev.id} className="border-b">
                      <td className="py-2 text-gray-600">{new Date(ev.created_at).toLocaleString()}</td>
                      <td className="py-2">{ev.phone_number}</td>
                      <td className="py-2">
                        <span className={ev.success ? 'text-green-600' : 'text-red-600'}>
                          {ev.success ? 'Success' : 'Failed'}
                        </span>
                      </td>
                      <td className="py-2 text-gray-400">{ev.failure_reason || '-'}</td>
                    </tr>
                  ))}
                  {loginHistory.length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-center text-gray-400">No login history</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        warning={confirmState?.warning ?? null}
        busy={confirmBusy}
        onCancel={() => {
          if (confirmBusy) return;
          setConfirmState(null);
        }}
        onConfirm={async () => {
          if (!confirmState) return;
          setConfirmBusy(true);
          try {
            await confirmState.onConfirm();
            setConfirmState(null);
          } finally {
            setConfirmBusy(false);
          }
        }}
      />
    </div>
  );
}
