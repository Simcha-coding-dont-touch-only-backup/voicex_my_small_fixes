import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { Users, Package, ShoppingCart } from 'lucide-react';
import { useAuth } from '../lib/auth-context';

interface DashboardStats {
  totalUsers: number | null;
  totalProducts: number | null;
  totalOrders: number | null;
  recentOrders: any[] | null;
}

export function DashboardPage() {
  const { adminUser, hasPermission } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: null,
    totalProducts: null,
    totalOrders: null,
    recentOrders: null,
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
        apiGet<any>('/catalog/products?per_page=1')
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
    }

    Promise.all(tasks).catch(console.error);
  }, [canSeeUsers, canSeeProducts, canSeeOrders]);

  const cards: Array<{ label: string; value: string | number; icon: typeof Users; color: string }> = [];
  if (canSeeUsers) {
    cards.push({ label: 'Total Users', value: stats.totalUsers ?? '-', icon: Users, color: 'bg-blue-500' });
  }
  if (canSeeProducts) {
    cards.push({ label: 'Products', value: stats.totalProducts ?? '-', icon: Package, color: 'bg-green-500' });
  }
  if (canSeeOrders) {
    cards.push({ label: 'Orders', value: stats.totalOrders ?? '-', icon: ShoppingCart, color: 'bg-purple-500' });
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
        <div className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
                      <td className="py-3 font-mono text-xs">{order.id.slice(-8)}</td>
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
