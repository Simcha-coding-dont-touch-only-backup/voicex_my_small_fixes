import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { apiPost } from '../lib/api';

interface CategoryOption {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
}

interface CategoryQuickCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (category: CategoryOption) => void;
  categories: CategoryOption[];
}

export function CategoryQuickCreateModal({
  open,
  onClose,
  onCreated,
  categories,
}: CategoryQuickCreateModalProps) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setParentId('');
      setError('');
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await apiPost<{ data: CategoryOption }>('/catalog/categories', {
        name: name.trim(),
        parent_id: parentId || null,
        sort_order: 0,
      });
      onCreated(r.data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create category.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-category-quick-create-modal
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">New Category</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-600">Name</label>
              <input
                ref={nameRef}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Parent Category</label>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              >
                <option value="">None (Top Level)</option>
                {categories
                  .filter((c) => c.depth < 2)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {'  '.repeat(c.depth)}
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
