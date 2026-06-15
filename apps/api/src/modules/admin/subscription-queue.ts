import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { retryRun, skipRun } from '../../lib/subscription-engine.js';

export const subscriptionQueueRouter = Router();

async function decorateRun(run: any) {
  const [{ data: user }, { data: phone }, { count: itemCount }] = await Promise.all([
    supabaseAdmin.from('users').select('name, email').eq('id', run.user_id).maybeSingle(),
    supabaseAdmin.from('user_phones').select('phone_number').eq('user_id', run.user_id).order('is_primary', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('subscription_delivery_run_items').select('id', { count: 'exact', head: true }).eq('run_id', run.id),
  ]);
  return {
    ...run,
    customer_name: user?.name || 'Unknown',
    email: user?.email || null,
    phone: phone?.phone_number || null,
    item_count: itemCount || 0,
  };
}

subscriptionQueueRouter.get('/', async (req, res) => {
  const page = parseInt((req.query.page as string) || '1', 10);
  const perPage = parseInt((req.query.per_page as string) || '20', 10);
  const status = req.query.status as string | undefined;
  const dateFrom = req.query.date_from as string | undefined;
  const dateTo = req.query.date_to as string | undefined;

  let query = supabaseAdmin.from('subscription_delivery_runs').select('*', { count: 'exact' });
  if (status) query = query.eq('status', status);
  if (dateFrom) query = query.gte('cycle_date', dateFrom);
  if (dateTo) query = query.lte('cycle_date', dateTo);

  const { data, count, error } = await query
    .order('cycle_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }

  const rows = await Promise.all((data || []).map(decorateRun));
  res.json({ success: true, data: rows, total: count || 0, page, per_page: perPage });
});

subscriptionQueueRouter.get('/:runId', async (req, res) => {
  const { data: run, error } = await supabaseAdmin
    .from('subscription_delivery_runs')
    .select('*')
    .eq('id', req.params.runId)
    .maybeSingle();
  if (error || !run) { res.status(404).json({ success: false, error: 'Run not found' }); return; }

  const [{ data: items }, { data: events }, decorated] = await Promise.all([
    supabaseAdmin.from('subscription_delivery_run_items').select('*').eq('run_id', run.id),
    supabaseAdmin.from('subscription_events').select('*, admin_users(name)').eq('run_id', run.id).order('created_at', { ascending: false }),
    decorateRun(run),
  ]);

  res.json({
    success: true,
    data: {
      ...decorated,
      items: items || [],
      left_out_items: (items || []).filter((i: any) => i.status !== 'included'),
      events: events || [],
    },
  });
});

subscriptionQueueRouter.post('/:runId/retry', async (req, res) => {
  const result = await retryRun(req.params.runId, 'admin', req.adminUser?.id ?? null);
  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: req.adminUser?.id ?? null,
    action: 'retry_subscription_run',
    entity_type: 'subscription_delivery_run',
    entity_id: req.params.runId,
    changes: result,
  });
  res.json({ success: true, data: result });
});

subscriptionQueueRouter.post('/:runId/skip', async (req, res) => {
  const result = await skipRun(req.params.runId, 'admin', req.adminUser?.id ?? null);
  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: req.adminUser?.id ?? null,
    action: 'skip_subscription_run',
    entity_type: 'subscription_delivery_run',
    entity_id: req.params.runId,
    changes: result,
  });
  res.json({ success: true, data: result });
});
