import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';

const etaDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ETA date must be YYYY-MM-DD');

export const etaInputArraySchema = z.array(
  z.object({
    eta_date: etaDateSchema,
  })
).max(10, 'At most 10 ETA dates can be saved');

export const etaPayloadSchema = z.object({
  etas: etaInputArraySchema,
});

export type EtaInput = z.infer<typeof etaInputArraySchema>[number];

export function sortOrderFulfillmentEtas<T extends { order_fulfillment_etas?: any[] }>(order: T): T {
  if (!Array.isArray(order.order_fulfillment_etas)) return order;

  return {
    ...order,
    order_fulfillment_etas: [...order.order_fulfillment_etas].sort((a, b) => {
      const sortDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (sortDiff !== 0) return sortDiff;
      return String(a.eta_date).localeCompare(String(b.eta_date));
    }),
  };
}

export async function replaceOrderFulfillmentEtas(
  orderId: string,
  etas: EtaInput[],
  adminUserId: string | undefined
) {
  const normalizedEtas = etas.map((eta, index) => ({
    order_id: orderId,
    eta_date: eta.eta_date,
    sort_order: index,
    created_by: adminUserId ?? null,
  }));

  const { error: deleteError } = await supabaseAdmin
    .from('order_fulfillment_etas')
    .delete()
    .eq('order_id', orderId);

  if (deleteError) throw new Error(deleteError.message);
  if (normalizedEtas.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('order_fulfillment_etas')
    .insert(normalizedEtas)
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}
