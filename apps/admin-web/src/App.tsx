import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import type { AdminPermissionKey } from '@voicex/shared';
import { AuthProvider, useAuth } from './lib/auth-context';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { UsersPage } from './pages/UsersPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { CartsPage } from './pages/CartsPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { ReportsPage } from './pages/ReportsPage';
import { IvrFlowsPage } from './pages/IvrFlowsPage';
import { LogsPage } from './pages/LogsPage';
import { AddressTestPage } from './pages/AddressTestPage';
import { SubAdminsPage } from './pages/SubAdminsPage';
import { DeletedProductsPage } from './pages/DeletedProductsPage';
import { DeletedCategoriesPage } from './pages/DeletedCategoriesPage';
import { SupportPage } from './pages/SupportPage';
import { FulfillmentPage } from './pages/FulfillmentPage';
import { MarketingLayout } from './components/marketing/MarketingLayout';
import { HomePage } from './pages/marketing/HomePage';
import { FeaturesPage } from './pages/marketing/FeaturesPage';
import { AboutPage } from './pages/marketing/AboutPage';
import { ContactPage } from './pages/marketing/ContactPage';

/**
 * Renders children if the current admin has the given permission, otherwise
 * silently redirects to the dashboard. The backend is the source of truth;
 * this guard exists so URL-typing past the hidden nav doesn't show a
 * forbidden page (or render an empty page after a 403).
 */
function RequirePermission({ permission, children }: { permission: AdminPermissionKey; children: React.ReactNode }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(permission)) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

/**
 * Strict super-admin gate. Only super_admin passes. Used for sub-admin
 * management. Legacy `admin` users are NOT allowed.
 */
function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { isSuperAdmin } = useAuth();
  if (!isSuperAdmin()) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

/**
 * Allows super_admin or legacy admin (any "full admin"). Sub-admins are
 * blocked. Used for the broad admin pages that don't have a dedicated
 * permission key yet (Users, Orders, Settings, Reports, etc.).
 */
function RequireFullAdmin({ children }: { children: React.ReactNode }) {
  const { adminUser } = useAuth();
  if (adminUser?.role !== 'super_admin' && adminUser?.role !== 'admin') {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

function ProtectedAdminRoutes() {
  const { session, adminUser, loading, authError, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  // Session exists but /me failed: render an explicit error screen instead
  // of spinning forever, so the user can sign out and try again.
  if (!adminUser && authError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {authError}
        </div>
        <button
          onClick={signOut}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Sign out
        </button>
      </div>
    );
  }

  // Still loading the admin profile.
  if (!adminUser) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />

        <Route path="/users" element={<RequireFullAdmin><UsersPage /></RequireFullAdmin>} />
        <Route path="/users/:id" element={<RequireFullAdmin><UserDetailPage /></RequireFullAdmin>} />

        <Route
          path="/categories"
          element={<RequirePermission permission="manageProducts"><CategoriesPage /></RequirePermission>}
        />
        {/* Deleted-categories trash is super_admin only — declared BEFORE
            /categories/:id so the static segment wins in the matcher
            (currently no /categories/:id route exists, but this guards
            against future shadowing). */}
        <Route
          path="/categories/deleted"
          element={<RequireSuperAdmin><DeletedCategoriesPage /></RequireSuperAdmin>}
        />
        <Route
          path="/products"
          element={<RequirePermission permission="manageProducts"><ProductsPage /></RequirePermission>}
        />
        <Route
          path="/products/deleted"
          element={<RequireSuperAdmin><DeletedProductsPage /></RequireSuperAdmin>}
        />
        <Route
          path="/products/:id"
          element={<RequirePermission permission="manageProducts"><ProductDetailPage /></RequirePermission>}
        />

        <Route path="/carts" element={<RequireFullAdmin><CartsPage /></RequireFullAdmin>} />
        <Route path="/orders" element={<RequireFullAdmin><OrdersPage /></RequireFullAdmin>} />
        <Route path="/orders/:id" element={<RequireFullAdmin><OrderDetailPage /></RequireFullAdmin>} />
        <Route path="/settings" element={<RequireFullAdmin><SettingsPage /></RequireFullAdmin>} />
        <Route path="/fulfillment" element={<RequireFullAdmin><FulfillmentPage /></RequireFullAdmin>} />
        <Route path="/reports" element={<RequireFullAdmin><ReportsPage /></RequireFullAdmin>} />
        <Route path="/ivr" element={<RequireFullAdmin><IvrFlowsPage /></RequireFullAdmin>} />
        <Route path="/logs" element={<RequireFullAdmin><LogsPage /></RequireFullAdmin>} />
        <Route path="/support" element={<RequireFullAdmin><SupportPage /></RequireFullAdmin>} />
        <Route path="/address-test" element={<RequireFullAdmin><AddressTestPage /></RequireFullAdmin>} />

        {/* Sub-admin management is super-admin only. */}
        <Route path="/sub-admins" element={<RequireSuperAdmin><SubAdminsPage /></RequireSuperAdmin>} />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public marketing site */}
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
        </Route>

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />

        {/* Authenticated admin portal */}
        <Route path="/admin/*" element={<ProtectedAdminRoutes />} />
      </Routes>
    </AuthProvider>
  );
}
