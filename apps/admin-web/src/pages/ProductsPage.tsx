import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete } from '../lib/api';
import { Search, Plus, ChevronLeft, ChevronRight, Pencil, Trash2, X, Loader2, ExternalLink } from 'lucide-react';

interface AsinLookupData {
  asin: string;
  url: string;
  name: string | null;
  description: string | null;
  price_cents: number | null;
  currency: string;
  availability: string;
  is_purchasable: boolean;
  images: { url: string; is_featured: boolean }[];
  brand: string | null;
}

function buildEditForm(p: any) {
  return {
    voicex_id: p.voicex_id || '',
    amazon_asin: p.amazon_asin || '',
    amazon_url: p.amazon_url || '',
    amazon_name: p.amazon_name || '',
    amazon_description: p.amazon_description || '',
    amazon_price_cents: p.amazon_price_cents ?? '',
    voice_name: p.voice_name || '',
    voice_description: p.voice_description || '',
    custom_price_cents: p.custom_price_cents ?? '',
    is_active: p.is_active,
    category_ids: p.catalog_product_categories?.map((c: any) => c.category_id) || [],
  };
}

export function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [asinInput, setAsinInput] = useState('');
  const [lookupData, setLookupData] = useState<AsinLookupData | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [createOverrides, setCreateOverrides] = useState({ voice_name: '', voice_description: '', custom_price_cents: '', category_ids: [] as string[] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const perPage = 20;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (search) params.set('search', search);
    apiGet<any>(`/catalog/products?${params}`).then((r) => {
      setProducts(r.data || []);
      setTotal(r.total || 0);
    });
  };

  useEffect(() => { load(); }, [page]);
  useEffect(() => {
    apiGet<any>('/catalog/categories').then((r) => setCategories(r.data || []));
  }, []);

  const handleLookup = async () => {
    const trimmed = asinInput.trim().toUpperCase();
    if (!trimmed) return;
    setLookupLoading(true);
    setLookupError('');
    setLookupData(null);
    try {
      const r = await apiPost<any>('/catalog/products/lookup-asin', { asin: trimmed });
      setLookupData(r.data);
      setAsinInput(trimmed);
    } catch (err: any) {
      setLookupError(err.message || 'Failed to look up product.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!lookupData) return;
    setSaving(true);
    try {
      await apiPost('/catalog/products', {
        amazon_asin: lookupData.asin,
        amazon_url: lookupData.url,
        amazon_name: lookupData.name,
        amazon_description: lookupData.description,
        amazon_price_cents: lookupData.price_cents,
        voice_name: createOverrides.voice_name || null,
        voice_description: createOverrides.voice_description || null,
        custom_price_cents: createOverrides.custom_price_cents ? parseInt(createOverrides.custom_price_cents) : null,
        category_ids: createOverrides.category_ids,
      });
      setShowForm(false);
      setAsinInput('');
      setLookupData(null);
      setLookupError('');
      setCreateOverrides({ voice_name: '', voice_description: '', custom_price_cents: '', category_ids: [] });
      load();
    } catch (err: any) {
      setLookupError(err.message || 'Failed to create product.');
    } finally {
      setSaving(false);
    }
  };

  const resetCreateForm = () => {
    setAsinInput('');
    setLookupData(null);
    setLookupError('');
    setCreateOverrides({ voice_name: '', voice_description: '', custom_price_cents: '', category_ids: [] });
  };

  const startEdit = (product: any) => {
    setEditingId(product.id);
    setEditForm(buildEditForm(product));
    setShowForm(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await apiPatch(`/catalog/products/${editingId}`, {
        ...editForm,
        amazon_price_cents: editForm.amazon_price_cents !== '' ? parseInt(editForm.amazon_price_cents) : null,
        custom_price_cents: editForm.custom_price_cents !== '' ? parseInt(editForm.custom_price_cents) : null,
      });
      setEditingId(null);
      setEditForm({});
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await apiDelete(`/catalog/products/${id}`);
    if (editingId === id) cancelEdit();
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Products</h2>
        <button onClick={() => { setShowForm(!showForm); if (showForm) resetCreateForm(); cancelEdit(); }}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
          <Plus size={16} /> Add Product
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <label className="text-sm font-medium text-gray-600">Amazon ASIN</label>
              <input
                value={asinInput}
                onChange={(e) => setAsinInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleLookup(); } }}
                placeholder="e.g. B09V3KXJPB"
                maxLength={10}
                className="mt-1 w-full rounded border px-3 py-2 text-sm font-mono tracking-wider"
              />
            </div>
            <button
              onClick={handleLookup}
              disabled={lookupLoading || !asinInput.trim()}
              className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {lookupLoading ? <><Loader2 size={14} className="animate-spin" /> Looking up...</> : 'Lookup'}
            </button>
            <button onClick={() => { setShowForm(false); resetCreateForm(); }} className="rounded border px-4 py-2 text-sm">Cancel</button>
          </div>

          {lookupError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{lookupError}</div>
          )}

          {lookupData && (
            <div>
              <div className="mb-4 grid gap-6 lg:grid-cols-2">
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-gray-700">Amazon Data (auto-fetched)</h4>
                  <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div>
                      <span className="text-xs font-medium text-gray-500">Name</span>
                      <p className="text-sm text-gray-800">{lookupData.name || '-'}</p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500">Description</span>
                      <p className="text-sm text-gray-800 max-h-24 overflow-y-auto">{lookupData.description ? lookupData.description.substring(0, 300) + (lookupData.description.length > 300 ? '...' : '') : '-'}</p>
                    </div>
                    <div className="flex gap-6">
                      <div>
                        <span className="text-xs font-medium text-gray-500">Price</span>
                        <p className="text-sm font-semibold text-gray-800">{lookupData.price_cents != null ? `$${(lookupData.price_cents / 100).toFixed(2)}` : '-'}</p>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-gray-500">Availability</span>
                        <p className="text-sm">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${lookupData.availability === 'in_stock' ? 'bg-green-100 text-green-700' : lookupData.availability === 'out_of_stock' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {lookupData.availability.replace(/_/g, ' ')}
                          </span>
                        </p>
                      </div>
                      {lookupData.brand && (
                        <div>
                          <span className="text-xs font-medium text-gray-500">Brand</span>
                          <p className="text-sm text-gray-800">{lookupData.brand}</p>
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500">ASIN</span>
                      <p className="text-sm font-mono text-gray-600">{lookupData.asin}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="mb-3 text-sm font-semibold text-gray-700">VoiceX Overrides <span className="font-normal text-gray-400">(optional)</span></h4>
                  <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
                    <div>
                      <label className="text-xs font-medium text-gray-500">Custom Name</label>
                      <input
                        value={createOverrides.voice_name}
                        onChange={(e) => setCreateOverrides({ ...createOverrides, voice_name: e.target.value })}
                        placeholder={lookupData.name || 'Leave blank to use Amazon name'}
                        className="mt-1 w-full rounded border px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Custom Description</label>
                      <textarea
                        value={createOverrides.voice_description}
                        onChange={(e) => setCreateOverrides({ ...createOverrides, voice_description: e.target.value })}
                        placeholder="Leave blank to use Amazon description"
                        rows={3}
                        className="mt-1 w-full rounded border px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Custom Price (cents)</label>
                      <input
                        type="number"
                        value={createOverrides.custom_price_cents}
                        onChange={(e) => setCreateOverrides({ ...createOverrides, custom_price_cents: e.target.value })}
                        placeholder={lookupData.price_cents != null ? `${lookupData.price_cents} (Amazon + markup)` : 'Leave blank for auto-markup'}
                        className="mt-1 w-full rounded border px-3 py-2 text-sm"
                      />
                    </div>
                    <p className="text-xs text-gray-400">If left blank, calls will use the Amazon data shown on the left.</p>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <label className="text-sm font-medium text-gray-600">Categories</label>
                <select
                  multiple
                  value={createOverrides.category_ids}
                  onChange={(e) => setCreateOverrides({ ...createOverrides, category_ids: Array.from(e.target.selectedOptions, (o) => o.value) })}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm h-24"
                >
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Create Product'}
                </button>
                <button onClick={() => { setShowForm(false); resetCreateForm(); }} className="rounded border px-4 py-2 text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-4">
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="flex gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..." className="rounded-lg border pl-9 pr-4 py-2 text-sm" />
          </div>
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">Search</button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">VoiceX ID</th>
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">ASIN</th>
              <th className="px-6 py-3 font-medium">Amazon Price</th>
              <th className="px-6 py-3 font-medium">Custom Price</th>
              <th className="px-6 py-3 font-medium">Active</th>
              <th className="px-6 py-3 font-medium">Lifetime Sold</th>
              <th className="px-6 py-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <Fragment key={p.id}>
                <tr className={`border-b hover:bg-gray-50 ${editingId === p.id ? 'bg-indigo-50' : ''}`}>
                  <td className="px-6 py-3 font-mono">{p.voicex_id}</td>
                  <td className="px-6 py-3">
                    <Link to={`/products/${p.id}`} className="text-indigo-600 hover:underline">
                      {p.voice_name || p.amazon_name || '-'}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-gray-500">{p.amazon_asin}</td>
                  <td className="px-6 py-3">{p.amazon_price_cents ? `$${(p.amazon_price_cents / 100).toFixed(2)}` : '-'}</td>
                  <td className="px-6 py-3">{p.custom_price_cents ? `$${(p.custom_price_cents / 100).toFixed(2)}` : '-'}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.is_active ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-600">{p.lifetime_qty_sold}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1">
                      {p.amazon_url && (
                        <a href={p.amazon_url} target="_blank" rel="noopener noreferrer" title="View on Amazon"
                          className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600">
                          <ExternalLink size={16} />
                        </a>
                      )}
                      {editingId === p.id ? (
                        <button onClick={cancelEdit} title="Cancel edit"
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                          <X size={16} />
                        </button>
                      ) : (
                        <button onClick={() => startEdit(p)} title="Edit product"
                          className="rounded p-1 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600">
                          <Pencil size={16} />
                        </button>
                      )}
                      <button onClick={() => handleDelete(p.id, p.voice_name || p.amazon_name || p.voicex_id)} title="Delete product"
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
                {editingId === p.id && (
                  <tr className="border-b bg-indigo-50/50">
                    <td colSpan={8} className="px-6 py-4">
                      <div className="rounded-lg border border-indigo-200 bg-white p-5">
                        <h4 className="mb-4 text-sm font-semibold text-gray-700">Edit Product</h4>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <label className="text-sm font-medium text-gray-600">VoiceX ID</label>
                            <input value={editForm.voicex_id} onChange={(e) => setEditForm({ ...editForm, voicex_id: e.target.value })}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon ASIN</label>
                            <input value={editForm.amazon_asin} onChange={(e) => setEditForm({ ...editForm, amazon_asin: e.target.value })}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon URL</label>
                            <input value={editForm.amazon_url} onChange={(e) => setEditForm({ ...editForm, amazon_url: e.target.value })}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon Name</label>
                            <input value={editForm.amazon_name} onChange={(e) => setEditForm({ ...editForm, amazon_name: e.target.value })}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon Description</label>
                            <input value={editForm.amazon_description} onChange={(e) => setEditForm({ ...editForm, amazon_description: e.target.value })}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon Price (cents)</label>
                            <input type="number" value={editForm.amazon_price_cents} onChange={(e) => setEditForm({ ...editForm, amazon_price_cents: e.target.value })}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Voice Name (override)</label>
                            <input value={editForm.voice_name} onChange={(e) => setEditForm({ ...editForm, voice_name: e.target.value })}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Voice Description (override)</label>
                            <input value={editForm.voice_description} onChange={(e) => setEditForm({ ...editForm, voice_description: e.target.value })}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Custom Price (cents)</label>
                            <input type="number" value={editForm.custom_price_cents} onChange={(e) => setEditForm({ ...editForm, custom_price_cents: e.target.value })}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div className="flex items-end pb-1">
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={editForm.is_active}
                                onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} />
                              Active
                            </label>
                          </div>
                          <div className="sm:col-span-2 lg:col-span-3">
                            <label className="text-sm font-medium text-gray-600">Categories</label>
                            <select multiple value={editForm.category_ids}
                              onChange={(e) => setEditForm({ ...editForm, category_ids: Array.from(e.target.selectedOptions, (o) => o.value) })}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm h-24">
                              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="mt-4 flex gap-2">
                          <button onClick={handleEditSave} disabled={saving}
                            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button onClick={cancelEdit} className="rounded border px-4 py-2 text-sm">Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t px-6 py-3">
          <span className="text-sm text-gray-500">{total} products</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded border px-3 py-1 text-sm disabled:opacity-50"><ChevronLeft size={16} /></button>
            <span className="px-3 py-1 text-sm">Page {page}</span>
            <button onClick={() => setPage(page + 1)} disabled={page * perPage >= total} className="rounded border px-3 py-1 text-sm disabled:opacity-50"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
