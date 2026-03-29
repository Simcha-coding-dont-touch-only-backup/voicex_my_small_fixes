import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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

  const handleDeleteAddress = async (addressId: string) => {
    if (!confirm('Delete this address?')) return;
    try {
      await apiDelete(`/users/${id}/addresses/${addressId}`);
      await refreshUser();
    } catch (err: any) {
      alert(err.message || 'Failed to delete address');
    }
  };

  const cancelAddressEdit = () => {
    setEditingAddressId(null);
    setAddingAddress(false);
    setAddressForm(emptyAddress);
  };

  if (!user) return <div className="text-gray-500">Loading...</div>;

  const addresses: any[] = user.addresses || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/users')} className="text-sm text-indigo-600 hover:underline">&larr; Back</button>
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEditAddress(addr)}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteAddress(addr.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )
              )}
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
    </div>
  );
}
