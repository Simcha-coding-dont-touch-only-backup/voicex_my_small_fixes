import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

export const settingsRouter = Router();

settingsRouter.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('settings')
    .select('*')
    .order('key');

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data });
});

settingsRouter.patch('/:key', async (req, res) => {
  const { value } = req.body;

  const { data, error } = await supabaseAdmin
    .from('settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', req.params.key)
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'update_setting',
    entity_type: 'setting',
    entity_id: req.params.key,
    changes: { value },
  });

  res.json({ success: true, data });
});
