export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface UserLookupResult {
  exists: boolean;
  user_id?: string;
  status?: 'active' | 'frozen' | 'deleted';
  name?: string;
}

export interface CartSummary {
  cart_id: string;
  item_count: number;
  total_quantity: number;
  total_price_cents: number;
}

export interface OrderSummary {
  order_id: string;
  order_date: string;
  status: string;
  total_cents: number;
  item_count: number;
}
