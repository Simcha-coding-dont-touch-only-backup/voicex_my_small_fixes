import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import {
  Users,
  Package,
  ShoppingCart,
  DollarSign,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { ProductThumbnail } from '../components/ProductThumbnail';
import type { LightboxImage } from '../components/ProductImageLightbox';

interface BestSellerRow {
  product_id: string;
  product_name: string;
  voicex_id: string;
  units_sold: number;
  thumbnail_url: string | null;
  amazon_image_urls: LightboxImage[] | null;
  amazon_price_cents: number | null;
  markup_price_cents: number | null;
  local_price_cents: number | null;
}

interface DashboardStats {
  totalUsers: number | null;
  totalProducts: number | null;
  totalOrders: number | null;
  recentOrders: any[] | null;
  salesTotalCents: number | null;
  profitTotalCents: number | null;
  bestSellers: BestSellerRow[] | null;
}

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPriceCell(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return formatUsdFromCents(cents);
}

function parseLightboxImages(raw: unknown): LightboxImage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: LightboxImage[] = [];
  for (const x of raw) {
    if (x && typeof x === 'object' && 'url' in x && typeof (x as { url: unknown }).url === 'string') {
      const o = x as { url: string; is_featured?: unknown };
      out.push({
        url: o.url,
        is_featured: Boolean(o.is_featured),
      });
    }
  }
  return out.length > 0 ? out : null;
}

export function DashboardPage() {
  const { adminUser, hasPermission } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: null,
    totalProducts: null,
    totalOrders: null,
    recentOrders: null,
    salesTotalCents: null,
    profitTotalCents: null,
    bestSellers: null,
  });

  const isFullAdmin = adminUser?.role === 'super_admin' || adminUser?.role === 'admin';
  const canSeeProducts = hasPermission('manageProducts');
  const canSeeUsers = isFullAdmin;
  const canSeeOrders = isFullAdmin;

  useEffect(() => {
    // Only fetch what we're actually allowed to see, otherwise the API
    // returns 403 and the dashboard would render a console error.
    const tasks: Array<Promise<void>> = [];

    if (canSeeUsers) {
      tasks.push(
        apiGet<any>('/users?per_page=1')
          .then((res) => setStats((s) => ({ ...s, totalUsers: res.total ?? 0 })))
          .catch(() => {})
      );
    }
    if (canSeeProducts) {
      tasks.push(
        apiGet<any>('/catalog/products?per_page=1&is_active=true')
          .then((res) => setStats((s) => ({ ...s, totalProducts: res.total ?? 0 })))
          .catch(() => {})
      );
    }
    if (canSeeOrders) {
      tasks.push(
        apiGet<any>('/orders?per_page=5')
          .then((res) => setStats((s) => ({
            ...s,
            totalOrders: res.total ?? 0,
            recentOrders: res.data ?? [],
          })))
          .catch(() => {})
      );
      tasks.push(
        apiGet<{ success: boolean; data?: Record<string, unknown> }>('/dashboard')
          .then((res) => {
            const d = res.data;
            if (!d) return;
            const rawSellers = d.best_sellers;
            const bestSellers: BestSellerRow[] = Array.isArray(rawSellers)
              ? rawSellers.map((row: Record<string, unknown>) => ({
                  product_id: String(row.product_id ?? ''),
                  product_name: String(row.product_name ?? ''),
                  voicex_id: String(row.voicex_id ?? ''),
                  units_sold: Number(row.units_sold ?? 0),
                  thumbnail_url:
                    row.thumbnail_url != null && String(row.thumbnail_url) !== ''
                      ? String(row.thumbnail_url)
                      : null,
                  amazon_image_urls: parseLightboxImages(row.amazon_image_urls),
                  amazon_price_cents: row.amazon_price_cents == null ? null : Number(row.amazon_price_cents),
                  markup_price_cents: row.markup_price_cents == null ? null : Number(row.markup_price_cents),
                  local_price_cents: row.local_price_cents == null ? null : Number(row.local_price_cents),
                }))
              : [];
            setStats((s) => ({
              ...s,
              salesTotalCents: Number(d.sales_total_cents ?? 0),
              profitTotalCents: Number(d.profit_total_cents ?? 0),
              bestSellers,
            }));
          })
          .catch(() => {})
      );
    }

    Promise.all(tasks).catch(console.error);
  }, [canSeeUsers, canSeeProducts, canSeeOrders]);

  const cards: Array<{ label: string; value: string | number; icon: LucideIcon; color: string }> = [];
  if (canSeeUsers) {
    cards.push({ label: 'Users', value: stats.totalUsers ?? '-', icon: Users, color: 'bg-blue-500' });
  }
  if (canSeeProducts) {
    cards.push({ label: 'Products', value: stats.totalProducts ?? '-', icon: Package, color: 'bg-green-500' });
  }
  if (canSeeOrders) {
    cards.push({ label: 'Orders', value: stats.totalOrders ?? '-', icon: ShoppingCart, color: 'bg-purple-500' });
    cards.push({
      label: 'Sales',
      value: stats.salesTotalCents == null ? '-' : formatUsdFromCents(stats.salesTotalCents),
      icon: DollarSign,
      color: 'bg-amber-500',
    });
    cards.push({
      label: 'Profit',
      value: stats.profitTotalCents == null ? '-' : formatUsdFromCents(stats.profitTotalCents),
      icon: TrendingUp,
      color: 'bg-emerald-600',
    });
  }

  return (
    <div>
      <h2 className="mb-1 text-2xl font-bold text-gray-800">Dashboard</h2>
      {adminUser && (
        <p className="mb-6 text-sm text-gray-500">
          Welcome back, {adminUser.name}.
        </p>
      )}

      {cards.length > 0 && (
        <div className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {cards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl bg-white p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className={`rounded-lg p-3 ${color}`}>
                  <Icon size={24} className="text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">{label}</p>
                  <p className="text-2xl font-bold text-gray-900">{value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canSeeOrders && (
        <>
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-gray-800">Recent Orders</h3>
            {stats.recentOrders === null ? (
              <p className="text-gray-500">Loading...</p>
            ) : stats.recentOrders.length === 0 ? (
              <p className="text-gray-500">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="pb-3 font-medium">Order ID</th>
                      <th className="pb-3 font-medium">Customer</th>
                      <th className="pb-3 font-medium">Status</th>
                      <th className="pb-3 font-medium">Total</th>
                      <th className="pb-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentOrders.map((order: any) => (
                      <tr key={order.id} className="border-b last:border-0">
                        <td className="py-3 font-mono text-xs">{String(order.id)}</td>
                        <td className="py-3">{order.users?.name || 'N/A'}</td>
                        <td className="py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            order.status === 'completed' ? 'bg-green-100 text-green-700' :
                            order.status === 'failed' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {order.status}
                          </span>
                        </td>
                        <td className="py-3">${(order.total_cents / 100).toFixed(2)}</td>
                        <td className="py-3 text-gray-500">{new Date(order.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-8 rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-gray-800">Best Sellers</h3>
            {stats.bestSellers === null ? (
              <p className="text-gray-500">Loading...</p>
            ) : stats.bestSellers.length === 0 ? (
              <p className="text-gray-500">No completed order data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="pb-3 font-medium w-14" scope="col">
                        <span className="sr-only">Image</span>
                      </th>
                      <th className="pb-3 font-medium">Product</th>
                      <th className="pb-3 font-medium">ID</th>
                      <th className="pb-3 font-medium">Sold</th>
                      <th className="pb-3 font-medium">Amazon</th>
                      <th className="pb-3 font-medium">Marked Up</th>
                      <th className="pb-3 font-medium">Local</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.bestSellers.map((row) => (
                      <tr key={row.product_id} className="border-b last:border-0">
                        <td className="py-3 align-middle">
                          <ProductThumbnail
                            thumbnailUrl={row.thumbnail_url}
                            images={row.amazon_image_urls}
                            alt={row.product_name || 'Product'}
                            size={40}
                          />
                        </td>
                        <td className="py-3 align-middle">{row.product_name || '—'}</td>
                        <td className="py-3 align-middle font-mono text-xs text-gray-600">
                          {row.voicex_id || '—'}
                        </td>
                        <td className="py-3 align-middle">{row.units_sold}</td>
                        <td className="py-3 align-middle">{formatPriceCell(row.amazon_price_cents)}</td>
                        <td className="py-3 align-middle">{formatPriceCell(row.markup_price_cents)}</td>
                        <td className="py-3 align-middle">{formatPriceCell(row.local_price_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!canSeeOrders && cards.length === 0 && (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <p className="text-gray-500">
            Use the navigation on the left to access the sections you have permission to view.
          </p>
        </div>
      )}
    </div>
  );
}
