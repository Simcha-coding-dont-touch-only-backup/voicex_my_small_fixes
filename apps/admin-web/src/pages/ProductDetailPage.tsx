import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPatch, apiDelete } from '../lib/api';

export function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

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
        is_active: r.data.is_active,
        category_ids: r.data.catalog_product_categories?.map((c: any) => c.category_id) || [],
      });
    });
    apiGet<any>('/catalog/categories').then((r) => setCategories(r.data || []));
  }, [id]);

  const handleSave = async () => {
    await apiPatch(`/catalog/products/${id}`, {
      ...form,
      amazon_price_cents: form.amazon_price_cents ? parseInt(form.amazon_price_cents) : null,
      custom_price_cents: form.custom_price_cents ? parseInt(form.custom_price_cents) : null,
    });
    setEditing(false);
    apiGet<any>(`/catalog/products/${id}`).then((r) => setProduct(r.data));
  };

  const handleDelete = async () => {
    if (!confirm('Delete this product?')) return;
    await apiDelete(`/catalog/products/${id}`);
    navigate('/products');
  };

  if (!product) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/products')} className="text-sm text-indigo-600 hover:underline">&larr; Back</button>
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
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries({
              voicex_id: 'VoiceX ID', amazon_asin: 'Amazon ASIN', amazon_url: 'Amazon URL',
              amazon_name: 'Amazon Name', amazon_description: 'Amazon Description',
              amazon_price_cents: 'Amazon Price (cents)', voice_name: 'Voice Name (override)',
              voice_description: 'Voice Description (override)', custom_price_cents: 'Custom Price (cents)',
            }).map(([key, label]) => (
              <div key={key}>
                <label className="text-sm font-medium text-gray-600">{label}</label>
                <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm" />
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Active
            </label>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-gray-600">Categories</label>
              <select multiple value={form.category_ids}
                onChange={(e) => setForm({ ...form, category_ids: Array.from(e.target.selectedOptions, (o) => o.value) })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm h-24">
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button onClick={handleSave} className="rounded bg-indigo-600 px-4 py-2 text-sm text-white">Save</button>
          </div>
        ) : (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              ['VoiceX ID', product.voicex_id],
              ['ASIN', product.amazon_asin],
              ['Amazon Name', product.amazon_name],
              ['Voice Name', product.voice_name || '-'],
              ['Amazon Price', product.amazon_price_cents ? `$${(product.amazon_price_cents / 100).toFixed(2)}` : '-'],
              ['Custom Price', product.custom_price_cents ? `$${(product.custom_price_cents / 100).toFixed(2)}` : '-'],
              ['Active', product.is_active ? 'Yes' : 'No'],
              ['Lifetime Sold', product.lifetime_qty_sold],
              ['Categories', product.catalog_product_categories?.map((c: any) => c.catalog_categories?.name).join(', ') || '-'],
            ].map(([label, value]) => (
              <div key={label as string} className="flex gap-2">
                <dt className="font-medium text-gray-500 w-32">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
