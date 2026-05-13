import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPatch, apiDelete } from '../lib/api';
import { Plus } from 'lucide-react';
import { CustomPriceReadonlyDisplay, customPriceInputPlaceholder } from '../lib/product-price';
import { SearchableMultiSelect } from '../components/SearchableMultiSelect';
import { CategoryQuickCreateModal } from '../components/CategoryQuickCreateModal';
import { ProductThumbnail } from '../components/ProductThumbnail';

export function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [defaultMarkupPercent, setDefaultMarkupPercent] = useState(15);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [quickCategoryOpen, setQuickCategoryOpen] = useState(false);

  useEffect(() => {
    apiGet<any>(`/catalog/products/${id}`).then((r) => {
      setProduct(r.data);
      setForm({
        voicex_id: r.data.voicex_id,
        amazon_asin: r.data.amazon_asin,
        amazon_url: r.data.amazon_url,
        amazon_name: r.data.amazon_name || '',
        amazon_description: r.data.amazon_description || '',
        amazon_price_cents: r.data.amazon_price_cents || '',
        voice_name: r.data.voice_name || '',
        voice_description: r.data.voice_description || '',
        custom_price_cents: r.data.custom_price_cents || '',
        local_price_cents: r.data.local_price_cents ?? '',
        is_active: r.data.is_active,
        category_ids: r.data.catalog_product_categories?.map((c: any) => c.category_id) || [],
      });
    });
    apiGet<any>('/catalog/categories').then((r) => setCategories(r.data || []));
    apiGet<any>('/settings').then((r) => {
      const row = (r.data || []).find((s: { key: string }) => s.key === 'default_markup_percent');
      if (row?.value != null && row.value !== '') {
        const n = parseFloat(String(row.value));
        if (!Number.isNaN(n)) setDefaultMarkupPercent(n);
      }
    });
  }, [id]);

  const handleSave = async () => {
    await apiPatch(`/catalog/products/${id}`, {
      ...form,
      amazon_price_cents: form.amazon_price_cents ? parseInt(form.amazon_price_cents) : null,
      custom_price_cents: form.custom_price_cents ? parseInt(form.custom_price_cents) : null,
      local_price_cents: form.local_price_cents !== '' && form.local_price_cents != null
        ? parseInt(String(form.local_price_cents), 10)
        : null,
    });
    setEditing(false);
    apiGet<any>(`/catalog/products/${id}`).then((r) => setProduct(r.data));
    window.dispatchEvent(new CustomEvent('voicex:alerts-count-refresh'));
  };

  const handleDelete = async () => {
    if (!confirm('Delete this product?')) return;
    await apiDelete(`/catalog/products/${id}`);
    navigate('/admin/products');
  };

  if (!product) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/admin/products')} className="text-sm text-indigo-600 hover:underline">&larr; Back</button>
        <ProductThumbnail
          thumbnailUrl={product.thumbnail_url}
          images={product.amazon_image_urls}
          alt={product.voice_name || product.amazon_name || product.voicex_id}
          size={64}
        />
        <h2 className="text-2xl font-bold text-gray-800">Product: {product.voice_name || product.amazon_name || product.voicex_id}</h2>
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Details</h3>
          <div className="flex gap-2">
            <button onClick={() => setEditing(!editing)} className="text-sm text-indigo-600 hover:underline">
              {editing ? 'Cancel' : 'Edit'}
            </button>
            <button onClick={handleDelete} className="text-sm text-red-600 hover:underline">Delete</button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-gray-600">VoiceX ID</label>
                <input value={form.voicex_id} onChange={(e) => setForm({ ...form, voicex_id: e.target.value })}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Amazon ASIN</label>
                <input value={form.amazon_asin} onChange={(e) => setForm({ ...form, amazon_asin: e.target.value })}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="mb-3 text-sm font-semibold text-indigo-600 uppercase tracking-wide">VoiceX Overrides</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-600">VoiceX Name</label>
                    <input value={form.voice_name} onChange={(e) => setForm({ ...form, voice_name: e.target.value })}
                      className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">VoiceX Description</label>
                    <input value={form.voice_description} onChange={(e) => setForm({ ...form, voice_description: e.target.value })}
                      className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Custom Price (cents)</label>
                    <input
                      type="number"
                      value={form.custom_price_cents}
                      onChange={(e) => setForm({ ...form, custom_price_cents: e.target.value })}
                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                      placeholder={customPriceInputPlaceholder(product.amazon_price_cents, defaultMarkupPercent)}
                      className="mt-1 w-full rounded border px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Local Store Price (cents, optional)</label>
                    <input
                      type="number"
                      value={form.local_price_cents}
                      onChange={(e) => setForm({ ...form, local_price_cents: e.target.value })}
                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                      placeholder="e.g. 1299 for $12.99 local retail"
                      className="mt-1 w-full rounded border px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <p className="mt-1 text-xs text-gray-500">Used for checkout savings vs VoiceX price. Leave blank to skip.</p>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="mb-3 text-sm font-semibold text-orange-600 uppercase tracking-wide">Amazon Data</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Amazon Name</label>
                    <input value={form.amazon_name} readOnly
                      className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Amazon Description</label>
                    <input value={form.amazon_description} readOnly
                      className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Amazon Price (cents)</label>
                    <input value={form.amazon_price_cents} readOnly
                      className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-600">Amazon URL</label>
              <input value={form.amazon_url} readOnly
                className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Active
              </label>
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-600">Categories</label>
                  <button
                    type="button"
                    onClick={() => setQuickCategoryOpen(true)}
                    className="flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
                    title="Create new category"
                  >
                    <Plus size={12} /> New
                  </button>
                </div>
                <SearchableMultiSelect
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  value={form.category_ids || []}
                  onChange={(ids) => setForm({ ...form, category_ids: ids })}
                  placeholder="Select categories..."
                />
              </div>
            </div>

            <button onClick={handleSave} className="rounded bg-indigo-600 px-4 py-2 text-sm text-white">Save</button>
          </div>
        ) : (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <dt className="font-medium text-blue-600">VoiceX ID</dt>
                <dd className="mt-0.5">{product.voicex_id}</dd>
              </div>
              <div>
                <dt className="font-medium text-blue-600">ASIN</dt>
                <dd className="mt-0.5">{product.amazon_asin}</dd>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="mb-3 text-sm font-semibold text-indigo-600 uppercase tracking-wide">VoiceX</h4>
                <dl className="space-y-3">
                  <div>
                    <dt className="font-medium text-blue-600">Name</dt>
                    <dd className="mt-0.5">{product.voice_name || <span className="text-gray-300">—</span>}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-blue-600">Description</dt>
                    <dd className="mt-0.5">{product.voice_description || <span className="text-gray-300">—</span>}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-blue-600">Price</dt>
                    <dd className="mt-0.5">
                      <CustomPriceReadonlyDisplay
                        product={product}
                        defaultMarkupPercent={defaultMarkupPercent}
                        whenEmpty={<span className="text-gray-300">—</span>}
                        showMarkupExplanation
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-blue-600">Local Store Price</dt>
                    <dd className="mt-0.5">
                      {product.local_price_cents != null
                        ? `$${(product.local_price_cents / 100).toFixed(2)}`
                        : <span className="text-gray-300">—</span>}
                    </dd>
                  </div>
                </dl>
              </div>

              <div>
                <h4 className="mb-3 text-sm font-semibold text-orange-600 uppercase tracking-wide">Amazon</h4>
                <dl className="space-y-3">
                  <div>
                    <dt className="font-medium text-blue-600">Name</dt>
                    <dd className="mt-0.5">{product.amazon_name || <span className="text-gray-300">—</span>}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-blue-600">Description</dt>
                    <dd className="mt-0.5">{product.amazon_description || <span className="text-gray-300">—</span>}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-blue-600">Price</dt>
                    <dd className="mt-0.5">{product.amazon_price_cents ? `$${(product.amazon_price_cents / 100).toFixed(2)}` : <span className="text-gray-300">—</span>}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="border-t pt-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <dt className="font-medium text-blue-600">Active</dt>
                  <dd className="mt-0.5">{product.is_active ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-blue-600">Lifetime Sold</dt>
                  <dd className="mt-0.5">{product.lifetime_qty_sold}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="font-medium text-blue-600">Categories</dt>
                  <dd className="mt-0.5">{product.catalog_product_categories?.map((c: any) => c.catalog_categories?.name).join(', ') || '-'}</dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </div>

      <CategoryQuickCreateModal
        open={quickCategoryOpen}
        onClose={() => setQuickCategoryOpen(false)}
        categories={categories}
        onCreated={(newCat) => {
          setCategories((prev) => [...prev, newCat]);
          setForm((prev: any) => ({
            ...prev,
            category_ids: [...(prev.category_ids || []), newCat.id],
          }));
        }}
      />
    </div>
  );
}
