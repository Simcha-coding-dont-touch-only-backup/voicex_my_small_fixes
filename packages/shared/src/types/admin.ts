export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  created_at: string;
  updated_at: string;
}

export type AdminRole = 'super_admin' | 'admin' | 'viewer';

export interface AdminAuditLog {
  id: string;
  admin_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Record<string, unknown> | null;
  created_at: string;
}
