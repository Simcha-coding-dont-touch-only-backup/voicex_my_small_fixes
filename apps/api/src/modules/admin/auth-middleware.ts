import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

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

    const { data: adminUser } = await supabaseAdmin
      .from('admin_users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!adminUser) {
      res.status(403).json({ success: false, error: 'Not an admin user' });
      return;
    }

    (req as any).adminUser = adminUser;
    next();
  } catch (error) {
    res.status(500).json({ success: false, error: 'Auth check failed' });
  }
}
