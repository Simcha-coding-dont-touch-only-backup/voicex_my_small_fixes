import { useEffect, useState } from 'react';
import {
  PERMISSION_KEYS,
  type AdminPermissionKey,
  type AdminPermissions,
  type AdminUser,
} from '@voicex/shared';
import { Plus, Trash2, KeyRound, Pencil, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../lib/api';
import { useAuth } from '../lib/auth-context';

type ApiList<T> = { success: boolean; data: T[] };
type ApiOne<T> = { success: boolean; data: T };

interface FormState {
  email: string;
  name: string;
  password: string;
  permissions: AdminPermissions;
}

const EMPTY_FORM: FormState = {
  email: '',
  name: '',
  password: '',
  permissions: {},
};

function emptyPermissions(): AdminPermissions {
  const out: AdminPermissions = {};
  for (const meta of PERMISSION_KEYS) {
    (out as Record<string, boolean>)[meta.key] = false;
  }
  return out;
}

function PasswordInput(props: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        required={props.required}
        minLength={props.minLength}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-gray-400 hover:text-gray-600 focus:outline-none"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function permissionSummary(user: AdminUser): string {
  if (user.role === 'super_admin') return 'Full access (super admin)';
  if (user.role === 'admin') return 'Full access (admin)';
  const granted = PERMISSION_KEYS.filter((p) => user.permissions?.[p.key]).map((p) => p.label);
  if (granted.length === 0) return 'Dashboard only';
  return granted.join(', ');
}

export function SubAdminsPage() {
  const { adminUser: currentUser } = useAuth();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>({ ...EMPTY_FORM, permissions: emptyPermissions() });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editPermissions, setEditPermissions] = useState<AdminPermissions>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiGet<ApiList<AdminUser>>('/sub-admins');
      setAdmins(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load admins');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setCreateForm({ ...EMPTY_FORM, permissions: emptyPermissions() });
    setCreateError('');
    setShowCreate(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      await apiPost<ApiOne<AdminUser>>('/sub-admins', {
        email: createForm.email.trim(),
        name: createForm.name.trim(),
        password: createForm.password,
        permissions: createForm.permissions,
      });
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create sub-admin');
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (target: AdminUser) => {
    setEditTarget(target);
    setEditName(target.name);
    setEditPermissions({ ...emptyPermissions(), ...(target.permissions || {}) });
    setEditError('');
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSavingEdit(true);
    setEditError('');
    try {
      await apiPatch<ApiOne<AdminUser>>(`/sub-admins/${editTarget.id}`, {
        name: editName.trim(),
        permissions: editPermissions,
      });
      setEditTarget(null);
      await load();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update sub-admin');
    } finally {
      setSavingEdit(false);
    }
  };

  const openReset = (target: AdminUser) => {
    setResetTarget(target);
    setResetPassword('');
    setResetError('');
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetting(true);
    setResetError('');
    try {
      await apiPost(`/sub-admins/${resetTarget.id}/reset-password`, { password: resetPassword });
      setResetTarget(null);
    } catch (err: any) {
      setResetError(err.message || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiDelete(`/sub-admins/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete sub-admin');
    } finally {
      setDeleting(false);
    }
  };

  const togglePermission = (
    setter: React.Dispatch<React.SetStateAction<AdminPermissions>>,
    key: AdminPermissionKey,
    value: boolean
  ) => {
    setter((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Sub-Admins</h2>
          <p className="mt-1 text-sm text-gray-500">
            Create limited admin accounts and choose which sections of the portal they can access.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus size={16} /> Add Sub-Admin
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Email</th>
              <th className="px-6 py-3 font-medium">Role</th>
              <th className="px-6 py-3 font-medium">Permissions</th>
              <th className="px-6 py-3 font-medium">Created</th>
              <th className="px-6 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">No admin users found</td></tr>
            ) : admins.map((admin) => {
              const isSelf = currentUser?.id === admin.id;
              const isSuper = admin.role === 'super_admin';
              return (
                <tr key={admin.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <span className="inline-flex items-center gap-2">
                      {isSuper && <ShieldCheck size={14} className="text-indigo-600" />}
                      {admin.name}
                      {isSelf && <span className="text-xs text-gray-400">(you)</span>}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{admin.email}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      isSuper ? 'bg-indigo-100 text-indigo-700' :
                      admin.role === 'admin' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {admin.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{permissionSummary(admin)}</td>
                  <td className="px-6 py-4 text-gray-500">{new Date(admin.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-1">
                      <button
                        disabled={isSuper || isSelf}
                        onClick={() => openEdit(admin)}
                        className="rounded p-1 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                        title={isSuper ? 'Cannot modify super admin' : 'Edit permissions'}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        disabled={isSuper || isSelf}
                        onClick={() => openReset(admin)}
                        className="rounded p-1 text-gray-400 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                        title={isSuper ? 'Cannot reset super admin' : 'Reset password'}
                      >
                        <KeyRound size={16} />
                      </button>
                      <button
                        disabled={isSuper || isSelf}
                        onClick={() => { setDeleteTarget(admin); setDeleteError(''); }}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                        title={isSuper ? 'Cannot delete super admin' : isSelf ? 'Cannot delete yourself' : 'Delete'}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreate} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Add Sub-Admin</h3>
            <p className="mt-1 text-sm text-gray-500">
              The new account can sign in immediately with the password you set here.
            </p>

            {createError && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{createError}</div>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  required
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
                <PasswordInput
                  required
                  minLength={8}
                  value={createForm.password}
                  onChange={(value) => setCreateForm({ ...createForm, password: value })}
                />
                <p className="mt-1 text-xs text-gray-400">At least 8 characters.</p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">Permissions</p>
                <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                  {PERMISSION_KEYS.map((meta) => (
                    <label key={meta.key} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={createForm.permissions[meta.key] === true}
                        onChange={(e) => setCreateForm({
                          ...createForm,
                          permissions: { ...createForm.permissions, [meta.key]: e.target.checked },
                        })}
                      />
                      <span>
                        <span className="font-medium text-gray-800">{meta.label}</span>
                        <span className="block text-xs text-gray-500">{meta.description}</span>
                      </span>
                    </label>
                  ))}
                  <p className="pt-1 text-xs text-gray-400">
                    Sub-admins always see the Dashboard. Anything not checked above is hidden and the API will refuse access.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleEdit} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Edit {editTarget.email}</h3>

            {editError && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{editError}</div>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">Permissions</p>
                <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                  {PERMISSION_KEYS.map((meta) => (
                    <label key={meta.key} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={editPermissions[meta.key] === true}
                        onChange={(e) => togglePermission(setEditPermissions, meta.key, e.target.checked)}
                      />
                      <span>
                        <span className="font-medium text-gray-800">{meta.label}</span>
                        <span className="block text-xs text-gray-500">{meta.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={savingEdit}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingEdit ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleReset} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Reset password</h3>
            <p className="mt-1 text-sm text-gray-500">Set a new password for {resetTarget.email}.</p>

            {resetError && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{resetError}</div>
            )}

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">New password</label>
              <PasswordInput
                required
                minLength={8}
                value={resetPassword}
                onChange={setResetPassword}
              />
              <p className="mt-1 text-xs text-gray-400">At least 8 characters.</p>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                disabled={resetting}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resetting}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {resetting ? 'Saving...' : 'Reset'}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Delete sub-admin</h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong> ({deleteTarget.email})?
              They will lose access immediately.
            </p>
            {deleteError && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
                disabled={deleting}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
