import { Router } from 'express';
import { usersRouter } from './users.js';
import { catalogRouter } from './catalog.js';
import { catalogTrashRouter } from './catalog-trash.js';
import { ordersRouter } from './orders.js';
import { settingsRouter } from './settings.js';
import { reportsRouter } from './reports.js';
import { ivrRouter } from './ivr.js';
import { logsRouter } from './logs.js';
import { cartsRouter } from './carts.js';
import { addressTestRouter } from './address-test.js';
import { subAdminsRouter } from './sub-admins.js';
import {
  authMiddleware,
  requirePermission,
  requireSuperAdmin,
  requireFullAdmin,
} from './auth-middleware.js';

export const adminRouter = Router();

adminRouter.use(authMiddleware);

// Tells the admin web app who is currently logged in (role + permissions).
// Available to every admin user regardless of role/permissions.
adminRouter.get('/me', (req, res) => {
  const adminUser = req.adminUser;
  if (!adminUser) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }
  res.json({
    success: true,
    data: {
      id: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: adminUser.role,
      permissions: adminUser.permissions ?? {},
    },
  });
});

// Product management is gated by the manageProducts permission so sub-admins
// can be granted this single capability.
adminRouter.use('/catalog', requirePermission('manageProducts'), catalogRouter);

// Trash (soft-deleted products / categories) is super-admin only. Sub-admins
// must not be able to see, restore, or permanently delete from the trash —
// that's the whole point of soft delete being invisible to them.
adminRouter.use('/catalog-trash', requireSuperAdmin, catalogTrashRouter);

// Everything else requires a full admin (super_admin OR legacy admin).
// Sub-admins and viewers are blocked. As more permission keys are added
// (e.g. manageOrders), individual routes can be relaxed to
// requirePermission(...) instead.
adminRouter.use('/users', requireFullAdmin, usersRouter);
adminRouter.use('/orders', requireFullAdmin, ordersRouter);
adminRouter.use('/settings', requireFullAdmin, settingsRouter);
adminRouter.use('/reports', requireFullAdmin, reportsRouter);
adminRouter.use('/ivr', requireFullAdmin, ivrRouter);
adminRouter.use('/logs', requireFullAdmin, logsRouter);
adminRouter.use('/carts', requireFullAdmin, cartsRouter);
adminRouter.use('/address-test', requireFullAdmin, addressTestRouter);

// Sub-admin management is super_admin only — only the top-level admin
// (the "Asteroid Band") can create or modify other admin accounts.
adminRouter.use('/sub-admins', requireSuperAdmin, subAdminsRouter);
