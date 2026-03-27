export interface Address {
  id: string;
  user_id: string;
  label: string | null;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  is_default: boolean;
  is_validated: boolean;
  google_place_id: string | null;
  created_at: string;
  updated_at: string;
}
