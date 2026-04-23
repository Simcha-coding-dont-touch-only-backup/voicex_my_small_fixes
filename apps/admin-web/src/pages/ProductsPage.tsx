import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { CustomPriceReadonlyDisplay, customPriceInputPlaceholder } from '../lib/product-price';
import { Search, Plus, ChevronLeft, ChevronRight, Pencil, Trash2, Trash, X, Loader2, ExternalLink, AlertTriangle } from 'lucide-react';
import { SearchableMultiSelect } from '../components/SearchableMultiSelect';
import { CategoryQuickCreateModal } from '../components/CategoryQuickCreateModal';
import { ProductThumbnail } from '../components/ProductThumbnail';

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
    local_price_cents: p.local_price_cents ?? '',
    is_active: p.is_active,
    category_ids: p.catalog_product_categories?.map((c: any) => c.category_id) || [],
  };
}

export function ProductsPage() {
  const { isSuperAdmin } = useAuth();
  const isSuper = isSuperAdmin();
  const [products, setProducts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [defaultMarkupPercent, setDefaultMarkupPercent] = useState(15);
  const [asinInput, setAsinInput] = useState('');
  const [lookupData, setLookupData] = useState<AsinLookupData | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [createOverrides, setCreateOverrides] = useState({
    voice_name: '',
    voice_description: '',
    custom_price_cents: '',
    local_price_cents: '',
    category_ids: [] as string[],
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [quickCategoryTarget, setQuickCategoryTarget] = useState<'create' | 'edit' | null>(null);
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([]);
  const perPage = 20;

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (search) params.set('search', search);
    if (filterCategoryIds.length > 0) params.set('category_ids', filterCategoryIds.join(','));
    apiGet<any>(`/catalog/products?${params}`).then((r) => {
      setProducts(r.data || []);
      setTotal(r.total || 0);
    });
  }, [page, search, filterCategoryIds]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet<any>('/catalog/categories').then((r) => setCategories(r.data || []));
    apiGet<any>('/settings').then((r) => {
      const row = (r.data || []).find((s: { key: string }) => s.key === 'default_markup_percent');
      if (row?.value != null && row.value !== '') {
        const n = parseFloat(String(row.value));
        if (!Number.isNaN(n)) setDefaultMarkupPercent(n);
      }
    });
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
        amazon_image_urls: lookupData.images || [],
        voice_name: createOverrides.voice_name || null,
        voice_description: createOverrides.voice_description || null,
        custom_price_cents: createOverrides.custom_price_cents ? parseInt(createOverrides.custom_price_cents) : null,
        local_price_cents: createOverrides.local_price_cents
          ? parseInt(createOverrides.local_price_cents, 10)
          : null,
        category_ids: createOverrides.category_ids,
      });
      setShowForm(false);
      setAsinInput('');
      setLookupData(null);
      setLookupError('');
      setCreateOverrides({ voice_name: '', voice_description: '', custom_price_cents: '', local_price_cents: '', category_ids: [] });
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
    setCreateOverrides({ voice_name: '', voice_description: '', custom_price_cents: '', local_price_cents: '', category_ids: [] });
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
      const currentForm = { ...editForm };
      await apiPatch(`/catalog/products/${editingId}`, {
        ...currentForm,
        amazon_price_cents: currentForm.amazon_price_cents !== '' ? parseInt(currentForm.amazon_price_cents) : null,
        custom_price_cents: currentForm.custom_price_cents !== '' ? parseInt(currentForm.custom_price_cents) : null,
        local_price_cents:
          currentForm.local_price_cents !== '' && currentForm.local_price_cents != null
            ? parseInt(String(currentForm.local_price_cents), 10)
            : null,
      });
      setEditingId(null);
      setEditForm({});
      load();
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiDelete(`/catalog/products/${deleteConfirm.id}`);
      if (editingId === deleteConfirm.id) cancelEdit();
      setProducts((prev) => prev.filter((p) => p.id !== deleteConfirm.id));
      setTotal((prev) => prev - 1);
      setDeleteConfirm(null);
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete product');
    } finally {
      setDeleting(false);
    }
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirm(null);
    setDeleteError(null);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Products</h2>
        <div className="flex items-center gap-2">
          {isSuper && (
            <Link
              to="/products/deleted"
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Trash size={16} /> Deleted Products
            </Link>
          )}
          <button onClick={() => { setShowForm(!showForm); if (showForm) resetCreateForm(); cancelEdit(); }}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
            <Plus size={16} /> Add Product
          </button>
        </div>
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
                    {lookupData.images && lookupData.images.length > 0 && (
                      <div className="flex items-start gap-3">
                        <ProductThumbnail
                          thumbnailUrl={
                            (lookupData.images.find((i) => i.is_featured) || lookupData.images[0])?.url || null
                          }
                          images={lookupData.images}
                          alt={lookupData.name || lookupData.asin}
                          size={88}
                        />
                        <div className="text-xs text-gray-500">
                          {lookupData.images.length} image{lookupData.images.length === 1 ? '' : 's'} found.
                          <br />
                          The featured one will be saved as a thumbnail; click to preview the full gallery.
                        </div>
                      </div>
                    )}
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
                        onChange={(e) => { const v = e.target.value; setCreateOverrides(prev => ({ ...prev, voice_name: v })); }}
                        placeholder={lookupData.name || 'Leave blank to use Amazon name'}
                        className="mt-1 w-full rounded border px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Custom Description</label>
                      <textarea
                        value={createOverrides.voice_description}
                        onChange={(e) => { const v = e.target.value; setCreateOverrides(prev => ({ ...prev, voice_description: v })); }}
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
                        onChange={(e) => { const v = e.target.value; setCreateOverrides(prev => ({ ...prev, custom_price_cents: v })); }}
                        onWheel={(e) => (e.target as HTMLInputElement).blur()}
                        placeholder={customPriceInputPlaceholder(lookupData.price_cents, defaultMarkupPercent)}
                        className="mt-1 w-full rounded border px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Local Store Price (cents, optional)</label>
                      <input
                        type="number"
                        value={createOverrides.local_price_cents}
                        onChange={(e) => { const v = e.target.value; setCreateOverrides(prev => ({ ...prev, local_price_cents: v })); }}
                        onWheel={(e) => (e.target as HTMLInputElement).blur()}
                        placeholder="e.g. 1299 for $12.99"
                        className="mt-1 w-full rounded border px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                    <p className="text-xs text-gray-400">If left blank, calls will use the Amazon data shown on the left.</p>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-600">Categories</label>
                  <button
                    type="button"
                    onClick={() => setQuickCategoryTarget('create')}
                    className="flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
                    title="Create new category"
                  >
                    <Plus size={12} /> New
                  </button>
                </div>
                <SearchableMultiSelect
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  value={createOverrides.category_ids}
                  onChange={(ids) => setCreateOverrides({ ...createOverrides, category_ids: ids })}
                  placeholder="Select categories..."
                />
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

      <div className="mb-4 flex flex-wrap items-start gap-3">
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="flex gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..." className="rounded-lg border pl-9 pr-4 py-2 text-sm" />
          </div>
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">Search</button>
        </form>
        <div className="min-w-[260px] flex-1 max-w-sm -mt-1">
          <SearchableMultiSelect
            options={[
              { value: '__all__', label: 'All' },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
            value={filterCategoryIds.length === 0 ? ['__all__'] : filterCategoryIds}
            onChange={(ids) => {
              const wasAll = filterCategoryIds.length === 0;
              const picked = ids.filter((id) => id !== '__all__');
              const justSelectedAll = ids.includes('__all__') && !wasAll;
              setFilterCategoryIds(justSelectedAll ? [] : picked);
              setPage(1);
            }}
            placeholder="Filter by categories..."
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="px-3 py-3 font-medium w-16">Image</th>
              <th className="px-6 py-3 font-medium">VoiceX ID</th>
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">ASIN</th>
              <th className="px-6 py-3 font-medium">Amazon Price</th>
              <th className="px-6 py-3 font-medium">Custom Price</th>
              <th className="px-6 py-3 font-medium">Local Price</th>
              <th className="px-6 py-3 font-medium">Active</th>
              <th className="px-6 py-3 font-medium">Lifetime Sold</th>
              <th className="px-6 py-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <Fragment key={p.id}>
                <tr className={`border-b hover:bg-gray-50 ${editingId === p.id ? 'bg-indigo-50' : ''}`}>
                  <td className="px-3 py-2">
                    <ProductThumbnail
                      thumbnailUrl={p.thumbnail_url}
                      images={p.amazon_image_urls}
                      alt={p.voice_name || p.amazon_name || p.voicex_id}
                      size={48}
                    />
                  </td>
                  <td className="px-6 py-3 font-mono">{p.voicex_id}</td>
                  <td className="px-6 py-3">
                    <Link to={`/products/${p.id}`} className="text-indigo-600 hover:underline">
                      {p.voice_name || p.amazon_name || '-'}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-gray-500">{p.amazon_asin}</td>
                  <td className="px-6 py-3">{p.amazon_price_cents ? `$${(p.amazon_price_cents / 100).toFixed(2)}` : '-'}</td>
                  <td className="px-6 py-3">
                    <CustomPriceReadonlyDisplay product={p} defaultMarkupPercent={defaultMarkupPercent} />
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    {p.local_price_cents != null ? `$${(p.local_price_cents / 100).toFixed(2)}` : '—'}
                  </td>
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
                      <button onClick={() => setDeleteConfirm({ id: p.id, name: p.voice_name || p.amazon_name || p.voicex_id })} title="Delete product"
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
                {editingId === p.id && (
                  <tr className="border-b bg-indigo-50/50">
                    <td colSpan={10} className="px-6 py-4">
                      <div className="rounded-lg border border-indigo-200 bg-white p-5">
                        <h4 className="mb-4 text-sm font-semibold text-gray-700">Edit Product</h4>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <label className="text-sm font-medium text-gray-600">VoiceX ID</label>
                            <input value={editForm.voicex_id} onChange={(e) => { const v = e.target.value; setEditForm((prev: any) => ({ ...prev, voicex_id: v })); }}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon ASIN</label>
                            <input value={editForm.amazon_asin} readOnly
                              className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon URL</label>
                            <input value={editForm.amazon_url} readOnly
                              className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon Name</label>
                            <input value={editForm.amazon_name} readOnly
                              className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon Description</label>
                            <input value={editForm.amazon_description} readOnly
                              className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon Price (cents)</label>
                            <input type="number" value={editForm.amazon_price_cents} readOnly
                              className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">VoiceX Name (override)</label>
                            <input value={editForm.voice_name} onChange={(e) => { const v = e.target.value; setEditForm((prev: any) => ({ ...prev, voice_name: v })); }}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">VoiceX Description (override)</label>
                            <input value={editForm.voice_description} onChange={(e) => { const v = e.target.value; setEditForm((prev: any) => ({ ...prev, voice_description: v })); }}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Custom Price (cents)</label>
                            <input
                              type="number"
                              value={editForm.custom_price_cents}
                              onChange={(e) => { const v = e.target.value; setEditForm((prev: any) => ({ ...prev, custom_price_cents: v })); }}
                              onWheel={(e) => (e.target as HTMLInputElement).blur()}
                              placeholder={customPriceInputPlaceholder(p.amazon_price_cents, defaultMarkupPercent)}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Local Store Price (cents)</label>
                            <input
                              type="number"
                              value={editForm.local_price_cents}
                              onChange={(e) => { const v = e.target.value; setEditForm((prev: any) => ({ ...prev, local_price_cents: v })); }}
                              onWheel={(e) => (e.target as HTMLInputElement).blur()}
                              placeholder="Optional — for savings at checkout"
                              className="mt-1 w-full rounded border px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </div>
                          <div className="flex items-end pb-1">
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={editForm.is_active}
                                onChange={(e) => { const v = e.target.checked; setEditForm((prev: any) => ({ ...prev, is_active: v })); }} />
                              Active
                            </label>
                          </div>
                          <div className="sm:col-span-2 lg:col-span-3">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-medium text-gray-600">Categories</label>
                              <button
                                type="button"
                                onClick={() => setQuickCategoryTarget('edit')}
                                className="flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
                                title="Create new category"
                              >
                                <Plus size={12} /> New
                              </button>
                            </div>
                            <SearchableMultiSelect
                              options={categories.map((c) => ({ value: c.id, label: c.name }))}
                              value={editForm.category_ids || []}
                              onChange={(ids) => setEditForm((prev: any) => ({ ...prev, category_ids: ids }))}
                              placeholder="Select categories..."
                            />
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

      <CategoryQuickCreateModal
        open={quickCategoryTarget !== null}
        onClose={() => setQuickCategoryTarget(null)}
        categories={categories}
        onCreated={(newCat) => {
          setCategories((prev) => [...prev, newCat]);
          if (quickCategoryTarget === 'create') {
            setCreateOverrides((prev) => ({
              ...prev,
              category_ids: [...prev.category_ids, newCat.id],
            }));
          } else if (quickCategoryTarget === 'edit') {
            setEditForm((prev: any) => ({
              ...prev,
              category_ids: [...(prev.category_ids || []), newCat.id],
            }));
          }
        }}
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete Product</h3>
            </div>
            <p className="mb-6 text-sm text-gray-600">
              {isSuper ? (
                <>This will <span className="font-medium text-red-700">permanently delete</span> <span className="font-medium text-gray-900">"{deleteConfirm.name}"</span>. This action cannot be undone.</>
              ) : (
                <>Are you sure you want to delete <span className="font-medium text-gray-900">"{deleteConfirm.name}"</span>? This action cannot be undone.</>
              )}
            </p>
            {deleteError && (
              <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {deleteError}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={closeDeleteConfirm}
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
