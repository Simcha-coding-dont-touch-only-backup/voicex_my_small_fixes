import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../lib/api';
import { Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';

export function CategoriesPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', parent_id: '', sort_order: 0 });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => apiGet<any>('/catalog/categories').then((r) => setCategories(r.data || []));

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, parent_id: form.parent_id || null };
    if (editId) {
      await apiPatch(`/catalog/categories/${editId}`, body);
    } else {
      await apiPost('/catalog/categories', body);
    }
    setShowForm(false);
    setEditId(null);
    setForm({ name: '', parent_id: '', sort_order: 0 });
    load();
  };

  const handleEdit = (cat: any) => {
    setEditId(cat.id);
    setForm({ name: cat.name, parent_id: cat.parent_id || '', sort_order: cat.sort_order });
    setShowForm(true);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await apiDelete(`/catalog/categories/${deleteConfirm.id}`);
      setDeleteConfirm(null);
      load();
    } finally {
      setDeleting(false);
    }
  };

  const buildTree = (parentId: string | null = null, depth = 0): any[] => {
    return categories
      .filter((c) => c.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .flatMap((c) => [{ ...c, indent: depth }, ...buildTree(c.id, depth + 1)]);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Categories</h2>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ name: '', parent_id: '', sort_order: 0 }); }}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          <Plus size={16} /> Add Category
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-sm font-medium text-gray-600">Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Parent Category</label>
              <select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm">
                <option value="">None (Top Level)</option>
                {categories.filter((c) => c.depth < 2).map((c) => (
                  <option key={c.id} value={c.id}>{'  '.repeat(c.depth)}{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Sort Order</label>
              <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
              {editId ? 'Update' : 'Create'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded border px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Level</th>
              <th className="px-6 py-3 font-medium">Sort</th>
              <th className="px-6 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {buildTree().map((cat) => (
              <tr key={cat.id} className="border-b hover:bg-gray-50">
                <td className="px-6 py-3" style={{ paddingLeft: `${24 + cat.indent * 24}px` }}>
                  {cat.name}
                </td>
                <td className="px-6 py-3 text-gray-500">{cat.depth + 1}</td>
                <td className="px-6 py-3 text-gray-500">{cat.sort_order}</td>
                <td className="px-6 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(cat)} className="text-gray-400 hover:text-indigo-600"><Pencil size={16} /></button>
                    <button onClick={() => setDeleteConfirm({ id: cat.id, name: cat.name })} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete Category</h3>
            </div>
            <p className="mb-6 text-sm text-gray-600">
              Are you sure you want to delete <span className="font-medium text-gray-900">"{deleteConfirm.name}"</span>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
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
