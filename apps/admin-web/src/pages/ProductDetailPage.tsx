import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPatch, apiDelete } from '../lib/api';
import { Plus } from 'lucide-react';
import { customPriceInputPlaceholder } from '../lib/product-price';
import { SearchableMultiSelect } from '../components/SearchableMultiSelect';
import { CategoryQuickCreateModal } from '../components/CategoryQuickCreateModal';
import { ProductThumbnail } from '../components/ProductThumbnail';
import { ProductDetailView } from '../components/ProductDetailView';
import { CatalogProductStatusBadge } from '../components/CatalogProductStatusBadge';
import { isCatalogProductStatus } from '@voicex/shared';

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
        status: r.data.status === 'active' || r.data.status === 'inactive' || r.data.status === 'frozen'
          ? r.data.status
          : 'inactive',
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
    try {
      await apiPatch(`/catalog/products/${id}`, {
        ...form,
        amazon_price_cents: form.amazon_price_cents ? parseInt(form.amazon_price_cents) : null,
        custom_price_cents: form.custom_price_cents ? parseInt(form.custom_price_cents) : null,
        local_price_cents: form.local_price_cents !== '' && form.local_price_cents != null
          ? parseInt(String(form.local_price_cents), 10)
          : null,
      });
      setEditing(false);
      const r = await apiGet<any>(`/catalog/products/${id}`);
      setProduct(r.data);
      window.dispatchEvent(new CustomEvent('voicex:alerts-count-refresh'));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to save product');
    }
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
          size={96}
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
              <div>
                <label className="text-sm font-medium text-gray-600">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="frozen">Frozen</option>
                </select>
                {isCatalogProductStatus(form.status) && form.status === 'frozen' ? (
                  <div className="mt-2">
                    <CatalogProductStatusBadge
                      status="frozen"
                      frozenSource={
                        product.status === 'frozen' && product.frozen_source === 'auto' && form.status === 'frozen'
                          ? 'auto'
                          : 'manual'
                      }
                      stacked
                    />
                  </div>
                ) : null}
              </div>
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
          <ProductDetailView product={product} defaultMarkupPercent={defaultMarkupPercent} />
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
