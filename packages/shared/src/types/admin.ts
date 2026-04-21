export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  permissions: AdminPermissions;
  created_at: string;
  updated_at: string;
}

export type AdminRole = 'super_admin' | 'admin' | 'sub_admin' | 'viewer';

/**
 * Granular per-feature permissions, primarily for sub_admin accounts.
 * Add new permission keys here and to `PERMISSION_KEYS` below.
 *
 * `super_admin` and legacy `admin` roles implicitly have ALL permissions
 * regardless of what is stored in this object.
 */
export interface AdminPermissions {
  manageProducts?: boolean;
}

export type AdminPermissionKey = keyof AdminPermissions;

export interface AdminPermissionMeta {
  key: AdminPermissionKey;
  label: string;
  description: string;
}

/**
 * Single source of truth for the permission UI checklist on the
 * Sub-Admins page. Keep `PERMISSION_KEYS` in sync with `AdminPermissions`.
 */
export const PERMISSION_KEYS: AdminPermissionMeta[] = [
  {
    key: 'manageProducts',
    label: 'Manage Products',
    description: 'Access categories and products in the admin portal.',
  },
];

/**
 * Returns true if the given admin user (or partial subset) is allowed to
 * perform the action identified by `key`.
 *
 * - super_admin: always true
 * - admin (legacy): always true (backwards compatibility)
 * - sub_admin / viewer: only when permissions[key] === true
 */
export function hasPermission(
  user: Pick<AdminUser, 'role' | 'permissions'> | null | undefined,
  key: AdminPermissionKey
): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;
  return user.permissions?.[key] === true;
}

export function isSuperAdmin(
  user: Pick<AdminUser, 'role'> | null | undefined
): boolean {
  return user?.role === 'super_admin';
}

export interface AdminAuditLog {
  id: string;
  admin_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Record<string, unknown> | null;
  created_at: string;
}
