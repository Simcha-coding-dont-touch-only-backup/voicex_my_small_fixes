import { Router } from 'express';
import { PERMISSION_KEYS, type AdminPermissions } from '@voicex/shared';
import { supabaseAdmin } from '../../lib/supabase.js';

export const subAdminsRouter = Router();

// All routes are mounted behind requireSuperAdmin in admin/routes.ts.

const ALLOWED_PERMISSION_KEYS = new Set(PERMISSION_KEYS.map((p) => p.key));

function sanitizePermissions(input: unknown): AdminPermissions {
  if (!input || typeof input !== 'object') return {};
  const out: AdminPermissions = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_PERMISSION_KEYS.has(key as keyof AdminPermissions)) continue;
    if (typeof value === 'boolean') {
      (out as Record<string, boolean>)[key] = value;
    }
  }
  return out;
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function logAudit(
  adminUserId: string,
  action: string,
  entityId: string,
  changes: Record<string, unknown> | null
) {
  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: adminUserId,
    action,
    entity_type: 'admin_user',
    entity_id: entityId,
    changes,
  });
}

const SUB_ADMINS_SORTABLE_COLUMNS = ['created_at', 'updated_at', 'name', 'email', 'role'];

// GET /api/admin/sub-admins
// Lists every admin row so the super admin can see existing admins and
// sub-admins side by side. Supports paging and sorting via the same shape
// used by the rest of the admin lists.
subAdminsRouter.get('/', async (req, res) => {
  const {
    page = '1',
    per_page = '20',
    sort_by = 'created_at',
    sort_dir = 'desc',
  } = req.query;

  const sortColumn = SUB_ADMINS_SORTABLE_COLUMNS.includes(sort_by as string)
    ? (sort_by as string)
    : 'created_at';
  const sortAscending = sort_dir === 'asc';
  const perPage = Math.max(1, Math.min(1000, parseInt(per_page as string) || 20));
  const currentPage = Math.max(1, parseInt(page as string) || 1);
  const offset = (currentPage - 1) * perPage;

  const { data, count, error } = await supabaseAdmin
    .from('admin_users')
    .select('id, email, name, role, permissions, created_at, updated_at', {
      count: 'exact',
    })
    .order(sortColumn, { ascending: sortAscending })
    .range(offset, offset + perPage - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({
    success: true,
    data,
    total: count || 0,
    page: currentPage,
    per_page: perPage,
    total_pages: Math.ceil((count || 0) / perPage),
  });
});

// POST /api/admin/sub-admins
// Creates a Supabase Auth user (or links an existing one) and inserts a
// `sub_admin` row in admin_users with the requested permissions.
subAdminsRouter.post('/', async (req, res) => {
  const { email, password, name, permissions } = req.body ?? {};

  if (!email || typeof email !== 'string') {
    res.status(400).json({ success: false, error: 'email is required' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ success: false, error: 'password must be at least 8 characters' });
    return;
  }
  if (!name || typeof name !== 'string') {
    res.status(400).json({ success: false, error: 'name is required' });
    return;
  }

  const cleanPermissions = sanitizePermissions(permissions);

  let userId: string;

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    const msg = createErr.message?.toLowerCase() ?? '';
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      try {
        const existingId = await findAuthUserIdByEmail(email);
        if (!existingId) {
          res.status(500).json({ success: false, error: createErr.message });
          return;
        }
        userId = existingId;
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message || 'Failed to look up user' });
        return;
      }
    } else {
      res.status(500).json({ success: false, error: createErr.message });
      return;
    }
  } else {
    userId = created.user.id;
  }

  const { data: existingAdmin } = await supabaseAdmin
    .from('admin_users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (existingAdmin) {
    res.status(409).json({
      success: false,
      error: 'An admin user with this email already exists',
    });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .insert({
      id: userId,
      email,
      name,
      role: 'sub_admin',
      permissions: cleanPermissions,
    })
    .select('id, email, name, role, permissions, created_at, updated_at')
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await logAudit(req.adminUser!.id, 'create_sub_admin', userId, {
    email,
    name,
    permissions: cleanPermissions,
  });

  res.status(201).json({ success: true, data });
});

// PATCH /api/admin/sub-admins/:id
// Updates the name and/or permissions of an existing admin row.
// Cannot be used to change role (use a dedicated route if/when needed) and
// cannot target a super_admin.
subAdminsRouter.patch('/:id', async (req, res) => {
  const targetId = req.params.id;
  const { name, permissions } = req.body ?? {};

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('admin_users')
    .select('id, role')
    .eq('id', targetId)
    .single();

  if (existingErr || !existing) {
    res.status(404).json({ success: false, error: 'Admin user not found' });
    return;
  }

  if (existing.role === 'super_admin') {
    res.status(403).json({ success: false, error: 'Cannot modify a super admin' });
    return;
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, error: 'name must be a non-empty string' });
      return;
    }
    updates.name = name;
  }
  if (permissions !== undefined) {
    updates.permissions = sanitizePermissions(permissions);
  }

  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .update(updates)
    .eq('id', targetId)
    .select('id, email, name, role, permissions, created_at, updated_at')
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await logAudit(req.adminUser!.id, 'update_sub_admin', targetId, updates);

  res.json({ success: true, data });
});

// POST /api/admin/sub-admins/:id/reset-password
// Sets a new password on the underlying Supabase Auth user.
subAdminsRouter.post('/:id/reset-password', async (req, res) => {
  const targetId = req.params.id;
  const { password } = req.body ?? {};

  if (!password || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ success: false, error: 'password must be at least 8 characters' });
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from('admin_users')
    .select('id, role')
    .eq('id', targetId)
    .single();

  if (!existing) {
    res.status(404).json({ success: false, error: 'Admin user not found' });
    return;
  }

  if (existing.role === 'super_admin') {
    res.status(403).json({ success: false, error: 'Cannot reset password for a super admin' });
    return;
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(targetId, { password });
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await logAudit(req.adminUser!.id, 'reset_sub_admin_password', targetId, null);

  res.json({ success: true, message: 'Password updated' });
});

// DELETE /api/admin/sub-admins/:id
// Removes the admin_users row and deletes the Supabase Auth user. Refuses
// to delete super admins or the currently-logged-in user.
subAdminsRouter.delete('/:id', async (req, res) => {
  const targetId = req.params.id;

  if (targetId === req.adminUser!.id) {
    res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from('admin_users')
    .select('id, role, email')
    .eq('id', targetId)
    .single();

  if (!existing) {
    res.status(404).json({ success: false, error: 'Admin user not found' });
    return;
  }

  if (existing.role === 'super_admin') {
    res.status(403).json({ success: false, error: 'Cannot delete a super admin' });
    return;
  }

  // admin_audit_logs.admin_user_id has ON DELETE SET NULL (see migration
  // 00014) so the audit trail survives this sub-admin being removed.
  const { error: deleteRowErr } = await supabaseAdmin
    .from('admin_users')
    .delete()
    .eq('id', targetId);

  if (deleteRowErr) {
    res.status(500).json({ success: false, error: deleteRowErr.message });
    return;
  }

  const { error: deleteAuthErr } = await supabaseAdmin.auth.admin.deleteUser(targetId);
  if (deleteAuthErr) {
    // Auth user may have already been removed; log but don't fail the call.
    console.warn('Failed to delete Supabase auth user:', deleteAuthErr.message);
  }

  await logAudit(req.adminUser!.id, 'delete_sub_admin', targetId, { email: existing.email });

  res.json({ success: true, message: 'Sub-admin deleted' });
});
