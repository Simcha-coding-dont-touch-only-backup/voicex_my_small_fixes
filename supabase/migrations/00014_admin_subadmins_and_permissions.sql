-- Sub-admins with granular permissions
--
-- 1. Extend the role check on admin_users to include 'sub_admin'.
-- 2. Add a flexible permissions JSONB column. Keys are permission identifiers
--    (e.g. 'manageProducts'), values are booleans. Empty {} means no
--    granular permissions granted (sub_admin only sees the dashboard).
--    super_admin / admin roles ignore this column and have full access.
--
-- Bootstrap (run manually after migration to promote your first super_admin):
--   UPDATE admin_users SET role = 'super_admin' WHERE email = 'simcha@targetjump.com';

ALTER TABLE admin_users
  DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('super_admin', 'admin', 'sub_admin', 'viewer'));

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Allow deleting an admin row without cascading-deleting their audit log
-- history. We keep the rows for the audit trail but null out the link.
ALTER TABLE admin_audit_logs
  ALTER COLUMN admin_user_id DROP NOT NULL;

ALTER TABLE admin_audit_logs
  DROP CONSTRAINT IF EXISTS admin_audit_logs_admin_user_id_fkey;

ALTER TABLE admin_audit_logs
  ADD CONSTRAINT admin_audit_logs_admin_user_id_fkey
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL;
