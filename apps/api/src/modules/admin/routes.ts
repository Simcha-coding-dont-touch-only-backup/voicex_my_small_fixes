import { Router } from 'express';
import { usersRouter } from './users.js';
import { catalogRouter } from './catalog.js';
import { ordersRouter } from './orders.js';
import { settingsRouter } from './settings.js';
import { reportsRouter } from './reports.js';
import { ivrRouter } from './ivr.js';
import { logsRouter } from './logs.js';
import { authMiddleware } from './auth-middleware.js';

export const adminRouter = Router();

adminRouter.use(authMiddleware);

adminRouter.use('/users', usersRouter);
adminRouter.use('/catalog', catalogRouter);
adminRouter.use('/orders', ordersRouter);
adminRouter.use('/settings', settingsRouter);
adminRouter.use('/reports', reportsRouter);
adminRouter.use('/ivr', ivrRouter);
adminRouter.use('/logs', logsRouter);
