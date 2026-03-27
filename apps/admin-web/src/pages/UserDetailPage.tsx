import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPatch } from '../lib/api';

export function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loginHistory, setLoginHistory] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', status: '', is_whitelisted: false });
  const [newPin, setNewPin] = useState('');

  useEffect(() => {
    apiGet<any>(`/users/${id}`).then((res) => {
      setUser(res.data);
      setForm({
        name: res.data.name,
        email: res.data.email || '',
        status: res.data.status,
        is_whitelisted: res.data.is_whitelisted,
      });
    });
    apiGet<any>(`/users/${id}/login-history`).then((res) => {
      setLoginHistory(res.data || []);
    });
  }, [id]);

  const handleSave = async () => {
    await apiPatch(`/users/${id}`, form);
    setEditing(false);
    apiGet<any>(`/users/${id}`).then((res) => setUser(res.data));
  };

  const handleResetPin = async () => {
    if (newPin.length !== 4) return alert('PIN must be 4 digits');
    await apiPatch(`/users/${id}/pin`, { pin: newPin });
    setNewPin('');
    alert('PIN updated');
  };

  if (!user) return <div className="text-gray-500">Loading...</div>;

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
              <div className="flex gap-2"><dt className="font-medium text-gray-500 w-28">Addresses</dt><dd>{user.addresses?.length || 0}</dd></div>
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
  );
}
