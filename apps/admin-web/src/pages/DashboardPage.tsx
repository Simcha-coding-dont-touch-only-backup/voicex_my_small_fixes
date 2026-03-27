import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { Users, Package, ShoppingCart, DollarSign } from 'lucide-react';

interface DashboardStats {
  totalUsers: number;
  totalProducts: number;
  totalOrders: number;
  recentOrders: any[];
}

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<any>('/users?per_page=1'),
      apiGet<any>('/catalog/products?per_page=1'),
      apiGet<any>('/orders?per_page=5'),
    ]).then(([users, products, orders]) => {
      setStats({
        totalUsers: users.total || 0,
        totalProducts: products.total || 0,
        totalOrders: orders.total || 0,
        recentOrders: orders.data || [],
      });
    }).catch(console.error);
  }, []);

  const cards = [
    { label: 'Total Users', value: stats?.totalUsers ?? '-', icon: Users, color: 'bg-blue-500' },
    { label: 'Products', value: stats?.totalProducts ?? '-', icon: Package, color: 'bg-green-500' },
    { label: 'Orders', value: stats?.totalOrders ?? '-', icon: ShoppingCart, color: 'bg-purple-500' },
  ];

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">Dashboard</h2>

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

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-800">Recent Orders</h3>
        {stats?.recentOrders.length === 0 ? (
          <p className="text-gray-500">No orders yet.</p>
        ) : (
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
              {stats?.recentOrders.map((order: any) => (
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
        )}
      </div>
    </div>
  );
}
