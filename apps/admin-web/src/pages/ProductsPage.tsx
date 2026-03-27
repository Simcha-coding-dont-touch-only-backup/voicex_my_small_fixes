import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../lib/api';
import { Search, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

export function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState({
    amazon_asin: '', amazon_url: '', amazon_name: '', amazon_price_cents: '',
    voice_name: '', custom_price_cents: '', category_ids: [] as string[],
  });
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiPost('/catalog/products', {
      ...form,
      amazon_price_cents: form.amazon_price_cents ? parseInt(form.amazon_price_cents) : null,
      custom_price_cents: form.custom_price_cents ? parseInt(form.custom_price_cents) : null,
    });
    setShowForm(false);
    setForm({ amazon_asin: '', amazon_url: '', amazon_name: '', amazon_price_cents: '', voice_name: '', custom_price_cents: '', category_ids: [] });
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Products</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
          <Plus size={16} /> Add Product
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="text-sm font-medium text-gray-600">Amazon ASIN</label>
              <input required value={form.amazon_asin} onChange={(e) => setForm({ ...form, amazon_asin: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Amazon URL</label>
              <input required value={form.amazon_url} onChange={(e) => setForm({ ...form, amazon_url: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Amazon Name</label>
              <input value={form.amazon_name} onChange={(e) => setForm({ ...form, amazon_name: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Amazon Price (cents)</label>
              <input type="number" value={form.amazon_price_cents} onChange={(e) => setForm({ ...form, amazon_price_cents: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Custom Name (override)</label>
              <input value={form.voice_name} onChange={(e) => setForm({ ...form, voice_name: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Custom Price (cents, override)</label>
              <input type="number" value={form.custom_price_cents} onChange={(e) => setForm({ ...form, custom_price_cents: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="text-sm font-medium text-gray-600">Categories</label>
              <select multiple value={form.category_ids}
                onChange={(e) => setForm({ ...form, category_ids: Array.from(e.target.selectedOptions, (o) => o.value) })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm h-24">
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">Create</button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded border px-4 py-2 text-sm">Cancel</button>
          </div>
        </form>
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
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-b hover:bg-gray-50">
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
              </tr>
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
