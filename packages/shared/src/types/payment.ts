export interface PaymentMethod {
  id: string;
  user_id: string;
  stripe_token: string;
  card_last4: string;
  card_brand: string | null;
  card_exp_month: number;
  card_exp_year: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}
