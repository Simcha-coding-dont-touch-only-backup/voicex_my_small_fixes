import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase.js';

export const usersRouter = Router();

usersRouter.get('/', async (req, res) => {
  const { page = '1', per_page = '20', search, status, sort_by = 'created_at', sort_dir = 'desc' } = req.query;
  const offset = (parseInt(page as string) - 1) * parseInt(per_page as string);

  let query = supabaseAdmin
    .from('users')
    .select('*, user_phones(phone_number, is_primary)', { count: 'exact' });

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }
  if (status) {
    query = query.eq('status', status as string);
  }

  const { data, count, error } = await query
    .order(sort_by as string, { ascending: sort_dir === 'asc' })
    .range(offset, offset + parseInt(per_page as string) - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({
    success: true,
    data,
    total: count || 0,
    page: parseInt(page as string),
    per_page: parseInt(per_page as string),
    total_pages: Math.ceil((count || 0) / parseInt(per_page as string)),
  });
});

usersRouter.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*, user_phones(*), addresses(*), payment_methods(id, card_last4, card_brand, card_exp_month, card_exp_year, is_default)')
    .eq('id', req.params.id)
    .single();

  if (error || !data) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  res.json({ success: true, data });
});

usersRouter.post('/', async (req, res) => {
  const { name, email, phone_number, pin, is_whitelisted } = req.body;

  const pinHash = pin ? await bcrypt.hash(pin, 10) : null;

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .insert({ name, email, status: 'active', is_whitelisted: is_whitelisted || false })
    .select()
    .single();

  if (error || !user) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to create user' });
    return;
  }

  if (phone_number) {
    await supabaseAdmin.from('user_phones').insert({
      user_id: user.id,
      phone_number,
      is_primary: true,
    });
  }

  if (pinHash) {
    await supabaseAdmin.from('user_pins').insert({
      user_id: user.id,
      pin_hash: pinHash,
    });
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'create_user',
    entity_type: 'user',
    entity_id: user.id,
    changes: { name, email, phone_number },
  });

  res.status(201).json({ success: true, data: user });
});

usersRouter.patch('/:id', async (req, res) => {
  const { name, email, status, is_whitelisted } = req.body;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (status !== undefined) updates.status = status;
  if (is_whitelisted !== undefined) updates.is_whitelisted = is_whitelisted;

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'update_user',
    entity_type: 'user',
    entity_id: req.params.id,
    changes: updates,
  });

  res.json({ success: true, data });
});

usersRouter.patch('/:id/pin', async (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length !== 4) {
    res.status(400).json({ success: false, error: 'PIN must be 4 digits' });
    return;
  }

  const pinHash = await bcrypt.hash(pin, 10);

  const { error } = await supabaseAdmin
    .from('user_pins')
    .upsert({ user_id: req.params.id, pin_hash: pinHash }, { onConflict: 'user_id' });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'reset_pin',
    entity_type: 'user',
    entity_id: req.params.id,
    changes: null,
  });

  res.json({ success: true, message: 'PIN updated' });
});

usersRouter.delete('/:id', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('users')
    .update({ status: 'deleted' })
    .eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'delete_user',
    entity_type: 'user',
    entity_id: req.params.id,
    changes: null,
  });

  res.json({ success: true, message: 'User deleted' });
});

usersRouter.delete('/:id/hard', async (req, res) => {
  const userId = req.params.id;

  const { count: orderCount } = await supabaseAdmin
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (orderCount && orderCount > 0) {
    res.status(409).json({
      success: false,
      error: `Cannot delete user: they have ${orderCount} order(s). Remove or reassign orders first.`,
    });
    return;
  }

  // Nullify call_sessions references (no CASCADE on that FK)
  await supabaseAdmin
    .from('call_sessions')
    .update({ user_id: null })
    .eq('user_id', userId);

  const { error } = await supabaseAdmin
    .from('users')
    .delete()
    .eq('id', userId);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'hard_delete_user',
    entity_type: 'user',
    entity_id: userId,
    changes: null,
  });

  res.json({ success: true, message: 'User permanently deleted' });
});

usersRouter.patch('/:id/addresses/:addressId', async (req, res) => {
  const { label, address1, address2, city, state, zip_code, country, is_default } = req.body;

  const updates: Record<string, unknown> = {};
  if (label !== undefined) updates.label = label;
  if (address1 !== undefined) updates.address1 = address1;
  if (address2 !== undefined) updates.address2 = address2;
  if (city !== undefined) updates.city = city;
  if (state !== undefined) updates.state = state;
  if (zip_code !== undefined) updates.zip_code = zip_code;
  if (country !== undefined) updates.country = country;
  if (is_default !== undefined) updates.is_default = is_default;

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .update(updates)
    .eq('id', req.params.addressId)
    .eq('user_id', req.params.id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  if (is_default) {
    await supabaseAdmin
      .from('addresses')
      .update({ is_default: false })
      .eq('user_id', req.params.id)
      .neq('id', req.params.addressId);
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'update_address',
    entity_type: 'address',
    entity_id: req.params.addressId,
    changes: updates,
  });

  res.json({ success: true, data });
});

usersRouter.post('/:id/addresses', async (req, res) => {
  const { label, address1, address2, city, state, zip_code, country, is_default } = req.body;

  if (!address1 || !city || !state || !zip_code) {
    res.status(400).json({ success: false, error: 'address1, city, state, and zip_code are required' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .insert({
      user_id: req.params.id,
      label: label || null,
      address1,
      address2: address2 || null,
      city,
      state,
      zip_code,
      country: country || 'US',
      is_default: is_default || false,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  if (is_default) {
    await supabaseAdmin
      .from('addresses')
      .update({ is_default: false })
      .eq('user_id', req.params.id)
      .neq('id', data.id);
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'create_address',
    entity_type: 'address',
    entity_id: data.id,
    changes: { label, address1, address2, city, state, zip_code, country },
  });

  res.status(201).json({ success: true, data });
});

usersRouter.delete('/:id/addresses/:addressId', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('addresses')
    .delete()
    .eq('id', req.params.addressId)
    .eq('user_id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'delete_address',
    entity_type: 'address',
    entity_id: req.params.addressId,
    changes: null,
  });

  res.json({ success: true, message: 'Address deleted' });
});

usersRouter.get('/:id/login-history', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('login_events')
    .select('*')
    .eq('user_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data });
});