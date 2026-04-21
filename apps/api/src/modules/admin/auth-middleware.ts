import type { Request, Response, NextFunction } from 'express';
import {
  hasPermission,
  isSuperAdmin,
  type AdminPermissionKey,
  type AdminUser,
} from '@voicex/shared';
import { supabaseAdmin } from '../../lib/supabase.js';

declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminUser;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }

    // Use '*' instead of an explicit column list so the query still works
    // before migration 00014 has been applied (which adds the permissions
    // column). Missing permissions are normalized to {} below.
    const { data: adminUser, error: adminErr } = await supabaseAdmin
      .from('admin_users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (adminErr || !adminUser) {
      res.status(403).json({ success: false, error: 'Not an admin user' });
      return;
    }

    const normalized: AdminUser = {
      ...adminUser,
      permissions: (adminUser.permissions ?? {}) as AdminUser['permissions'],
    };

    req.adminUser = normalized;
    (req as any).adminUser = normalized;
    next();
  } catch (error) {
    res.status(500).json({ success: false, error: 'Auth check failed' });
  }
}

/**
 * Returns Express middleware that allows the request only if the
 * authenticated admin user has the given permission. `super_admin` and
 * legacy `admin` roles always pass (see `hasPermission`).
 *
 * MUST be mounted after `authMiddleware`.
 */
export function requirePermission(key: AdminPermissionKey) {
  return function permissionMiddleware(req: Request, res: Response, next: NextFunction) {
    const adminUser = req.adminUser;
    if (!adminUser) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    if (!hasPermission(adminUser, key)) {
      res.status(403).json({ success: false, error: 'Forbidden: missing permission' });
      return;
    }
    next();
  };
}

/**
 * Strict super-admin gate. Only `role === 'super_admin'` passes.
 * Use this for things ONLY the top-level admin should do, such as
 * managing other admin accounts.
 *
 * MUST be mounted after `authMiddleware`.
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const adminUser = req.adminUser;
  if (!adminUser) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }
  if (!isSuperAdmin(adminUser)) {
    res.status(403).json({ success: false, error: 'Forbidden: super admin only' });
    return;
  }
  next();
}

/**
 * Allows full admins (`super_admin` OR legacy `admin`) but NOT sub_admin /
 * viewer. Use this for routes that existing admins have always been able
 * to use (users, orders, settings, reports, etc.) so the new RBAC
 * enforcement doesn't lock the existing legacy `admin` accounts out of
 * features they could use before this change.
 *
 * MUST be mounted after `authMiddleware`.
 */
export function requireFullAdmin(req: Request, res: Response, next: NextFunction) {
  const adminUser = req.adminUser;
  if (!adminUser) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }
  if (adminUser.role !== 'super_admin' && adminUser.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Forbidden: admin access required' });
    return;
  }
  next();
}
