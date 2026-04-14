import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Users, ShoppingCart, ShoppingBag, Package, FolderTree, Settings,
  BarChart3, Phone, LogOut, Menu, X, LayoutDashboard,
  ChevronsLeft, ChevronsRight, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../lib/auth-context';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/categories', label: 'Categories', icon: FolderTree },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/carts', label: 'Carts', icon: ShoppingBag },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/ivr', label: 'IVR Flows', icon: Phone },
  { to: '/logs', label: 'Logs', icon: AlertTriangle },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 transform bg-white shadow-lg transition-all duration-300 lg:relative lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'w-16' : 'w-64'}`}
      >
        <div className={`flex h-16 items-center border-b ${collapsed ? 'justify-center px-2' : 'justify-between px-6'}`}>
          {!collapsed && <span className="text-xl font-bold text-indigo-600">VoiceX</span>}
          <button className="lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
          <button
            className="hidden lg:flex items-center justify-center rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>

        <nav className={`mt-4 space-y-1 ${collapsed ? 'px-2' : 'px-3'}`}>
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center rounded-lg text-sm font-medium transition-colors ${
                  collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
              onClick={() => setSidebarOpen(false)}
              title={collapsed ? label : undefined}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className={`absolute bottom-0 w-full border-t ${collapsed ? 'p-2' : 'p-3'}`}>
          <button
            onClick={signOut}
            className={`flex w-full items-center rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 ${
              collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
            }`}
            title={collapsed ? 'Sign Out' : undefined}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center border-b bg-white px-6 shadow-sm">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <h1 className="ml-4 text-lg font-semibold text-gray-800 lg:ml-0">
            Admin Portal
          </h1>
        </header>

        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
