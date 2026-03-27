export interface User {
  id: string;
  name: string;
  email: string | null;
  status: UserStatus;
  is_whitelisted: boolean;
  created_at: string;
  updated_at: string;
}

export type UserStatus = 'active' | 'frozen' | 'deleted';

export interface UserPhone {
  id: string;
  user_id: string;
  phone_number: string;
  is_primary: boolean;
  created_at: string;
}

export interface UserPin {
  id: string;
  user_id: string;
  pin_hash: string;
  updated_at: string;
}

export interface LoginEvent {
  id: string;
  user_id: string;
  phone_number: string;
  success: boolean;
  failure_reason: string | null;
  created_at: string;
}
