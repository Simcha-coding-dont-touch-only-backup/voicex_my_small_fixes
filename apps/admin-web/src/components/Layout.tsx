import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Users, ShoppingCart, ShoppingBag, Package, FolderTree, Settings,
  BarChart3, Phone, LogOut, Menu, X, LayoutDashboard,
  ChevronsLeft, ChevronsRight, AlertTriangle, MapPin,
  Wrench, ChevronDown, ShieldCheck, Inbox, Truck,
} from 'lucide-react';
import type { AdminPermissionKey } from '@voicex/shared';
import { useAuth } from '../lib/auth-context';

type NavRequirement =
  | { kind: 'all' }
  | { kind: 'super' }
  | { kind: 'fullAdmin' }
  | { kind: 'permission'; key: AdminPermissionKey };

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  requires: NavRequirement;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, requires: { kind: 'all' } },
  { to: '/admin/users', label: 'Users', icon: Users, requires: { kind: 'fullAdmin' } },
  // Sub-admin management is the only super-admin only nav item.
  { to: '/admin/sub-admins', label: 'Sub-Admins', icon: ShieldCheck, requires: { kind: 'super' } },
  { to: '/admin/categories', label: 'Categories', icon: FolderTree, requires: { kind: 'permission', key: 'manageProducts' } },
  { to: '/admin/products', label: 'Products', icon: Package, requires: { kind: 'permission', key: 'manageProducts' } },
  { to: '/admin/carts', label: 'Carts', icon: ShoppingBag, requires: { kind: 'fullAdmin' } },
  { to: '/admin/orders', label: 'Orders', icon: ShoppingCart, requires: { kind: 'fullAdmin' } },
  { to: '/admin/fulfillment', label: 'Fulfillment', icon: Truck, requires: { kind: 'fullAdmin' } },
  { to: '/admin/settings', label: 'Settings', icon: Settings, requires: { kind: 'fullAdmin' } },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3, requires: { kind: 'fullAdmin' } },
  { to: '/admin/ivr', label: 'IVR Flows', icon: Phone, requires: { kind: 'fullAdmin' } },
  { to: '/admin/logs', label: 'Logs', icon: AlertTriangle, requires: { kind: 'fullAdmin' } },
  { to: '/admin/support', label: 'Support', icon: Inbox, requires: { kind: 'fullAdmin' } },
];

const TOOLS_ITEMS: NavItem[] = [
  { to: '/admin/address-test', label: 'Address Test', icon: MapPin, requires: { kind: 'fullAdmin' } },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { signOut, hasPermission, isSuperAdmin, adminUser } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const isFullAdmin = adminUser?.role === 'super_admin' || adminUser?.role === 'admin';

  const isAllowed = (item: NavItem) => {
    switch (item.requires.kind) {
      case 'all':
        return true;
      case 'super':
        return isSuperAdmin();
      case 'fullAdmin':
        return isFullAdmin;
      case 'permission':
        return hasPermission(item.requires.key);
    }
  };

  const visibleNav = NAV_ITEMS.filter(isAllowed);
  const visibleTools = TOOLS_ITEMS.filter(isAllowed);

  const toolsActive = visibleTools.some((item) => location.pathname === item.to);
  const [toolsOpen, setToolsOpen] = useState(toolsActive);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex flex-col transform bg-white shadow-lg transition-all duration-300 lg:relative lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'w-16' : 'w-64'}`}
      >
        <div className={`flex h-16 shrink-0 items-center border-b ${collapsed ? 'justify-center px-2' : 'justify-between px-6'}`}>
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

        <nav className={`flex-1 overflow-y-auto mt-4 space-y-1 ${collapsed ? 'px-2' : 'px-3'}`}>
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
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

          {visibleTools.length > 0 && (
            collapsed ? (
              visibleTools.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center justify-center rounded-lg px-2 py-2.5 text-sm font-medium transition-colors ${
                      isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`
                  }
                  onClick={() => setSidebarOpen(false)}
                  title={label}
                >
                  <Icon size={18} className="shrink-0" />
                </NavLink>
              ))
            ) : (
              <>
                <button
                  onClick={() => setToolsOpen(!toolsOpen)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    toolsActive ? 'text-indigo-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <Wrench size={18} className="shrink-0" />
                  <span className="flex-1 text-left">Tools</span>
                  <ChevronDown size={16} className={`shrink-0 transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
                </button>
                {toolsOpen && (
                  <div className="ml-4 space-y-1">
                    {visibleTools.map(({ to, label, icon: Icon }) => (
                      <NavLink
                        key={to}
                        to={to}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                          }`
                        }
                        onClick={() => setSidebarOpen(false)}
                      >
                        <Icon size={16} className="shrink-0" />
                        <span>{label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </>
            )
          )}
        </nav>

        <div className={`shrink-0 border-t ${collapsed ? 'p-2' : 'p-3'}`}>
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

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center border-b bg-white px-4 shadow-sm sm:px-6">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <h1 className="ml-3 min-w-0 truncate text-lg font-semibold text-gray-800 sm:ml-4 lg:ml-0">
            Admin Portal
          </h1>
        </header>

        <main className="flex-1 overflow-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
