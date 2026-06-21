import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase.js';
import { solaTokenize } from '../../lib/sola.js';

export const usersRouter = Router();

const USERS_SORTABLE_COLUMNS = ['created_at', 'name', 'email', 'status', 'id', 'returns_count'];

/**
 * Validate an incoming custom markup percent. Returns the normalized value
 * (a finite number >= 0, or `null` to clear it) or an error message.
 */
function parseCustomMarkupPercent(
  raw: unknown,
): { value: number | null } | { error: string } {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(num) || num < 0) {
    return { error: 'Custom markup percent must be a number greater than or equal to 0' };
  }
  return { value: num };
}

usersRouter.get('/', async (req, res) => {
  const { page = '1', per_page = '20', search, status, sort_by = 'created_at', sort_dir = 'desc' } = req.query;
  const sortColumn = USERS_SORTABLE_COLUMNS.includes(sort_by as string) ? (sort_by as string) : 'created_at';
  const sortAscending = sort_dir === 'asc';
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
    .order(sortColumn, { ascending: sortAscending })
    .range(offset, offset + parseInt(per_page as string) - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Subscription column: number of active deliveries (0-4) per user.
  const userIds = (data || []).map((u: any) => u.id);
  const subCountByUser = await activeDeliveryCountByUser(userIds);
  const enriched = (data || []).map((u: any) => ({ ...u, subscription_count: subCountByUser.get(u.id) || 0 }));

  res.json({
    success: true,
    data: enriched,
    total: count || 0,
    page: parseInt(page as string),
    per_page: parseInt(per_page as string),
    total_pages: Math.ceil((count || 0) / parseInt(per_page as string)),
  });
});

/** Map of user_id -> count of active subscription deliveries (0-4). */
async function activeDeliveryCountByUser(userIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (userIds.length === 0) return map;
  const { data: subs } = await supabaseAdmin
    .from('subscriptions')
    .select('id, user_id, subscription_deliveries(status)')
    .in('user_id', userIds);
  for (const s of subs || []) {
    const active = ((s as any).subscription_deliveries || []).filter((d: any) => d.status === 'active').length;
    map.set((s as any).user_id, active);
  }
  return map;
}

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

  // Subscription box: active delivery count + subscription id (if any).
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('id, subscription_deliveries(status)')
    .eq('user_id', req.params.id)
    .maybeSingle();
  const subscriptionCount = sub ? ((sub as any).subscription_deliveries || []).filter((d: any) => d.status === 'active').length : 0;

  res.json({ success: true, data: { ...data, subscription_id: sub?.id ?? null, subscription_count: subscriptionCount } });
});

usersRouter.post('/', async (req, res) => {
  const { name, email, phone_number, pin, is_whitelisted } = req.body;

  const markupResult = parseCustomMarkupPercent(req.body.custom_markup_percent);
  if ('error' in markupResult) {
    res.status(400).json({ success: false, error: markupResult.error });
    return;
  }

  // Whitelist and custom markup are mutually exclusive: a whitelisted user
  // always pays the base Amazon price, so any custom markup is cleared.
  const whitelisted = !!is_whitelisted;
  const customMarkup = whitelisted ? null : markupResult.value;

  const pinHash = pin ? await bcrypt.hash(pin, 10) : null;

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .insert({
      name,
      email,
      status: 'active',
      is_whitelisted: whitelisted,
      custom_markup_percent: customMarkup,
    })
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

  let markup: number | null | undefined;
  if (req.body.custom_markup_percent !== undefined) {
    const markupResult = parseCustomMarkupPercent(req.body.custom_markup_percent);
    if ('error' in markupResult) {
      res.status(400).json({ success: false, error: markupResult.error });
      return;
    }
    markup = markupResult.value;
  }

  // Enforce mutual exclusivity between whitelist and custom markup.
  if (is_whitelisted !== undefined) {
    const whitelisted = !!is_whitelisted;
    updates.is_whitelisted = whitelisted;
    if (whitelisted) {
      // Turning whitelist on clears any custom markup.
      updates.custom_markup_percent = null;
    } else if (markup !== undefined) {
      updates.custom_markup_percent = markup;
    }
  } else if (markup !== undefined) {
    // Setting a custom markup turns whitelist off; clearing it leaves whitelist as-is.
    updates.custom_markup_percent = markup;
    if (markup !== null) updates.is_whitelisted = false;
  }

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

  // Nullify references in tables without CASCADE on their FK
  await supabaseAdmin
    .from('call_sessions')
    .update({ user_id: null })
    .eq('user_id', userId);

  await supabaseAdmin
    .from('ivr_error_logs')
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

// ============================================================
// PAYMENT METHODS (saved cards)
// ============================================================

usersRouter.post('/:id/payment-methods', async (req, res) => {
  const { card_number, exp_month, exp_year, cvv, zip, is_default } = req.body;

  const cleanNum = String(card_number || '').replace(/\D/g, '');
  if (cleanNum.length < 13 || cleanNum.length > 19) {
    res.status(400).json({ success: false, error: 'Invalid card number' });
    return;
  }

  const monthInt = parseInt(String(exp_month), 10);
  const yearInt = parseInt(String(exp_year), 10);
  if (!monthInt || monthInt < 1 || monthInt > 12) {
    res.status(400).json({ success: false, error: 'Invalid expiration month' });
    return;
  }
  if (!yearInt || yearInt < 2000) {
    res.status(400).json({ success: false, error: 'Invalid expiration year' });
    return;
  }

  // Sola expects MMYY format
  const expMM = String(monthInt).padStart(2, '0');
  const expYY = String(yearInt % 100).padStart(2, '0');
  const expCombined = `${expMM}${expYY}`;

  const cleanCvv = cvv ? String(cvv).replace(/\D/g, '') : undefined;
  const cleanZip = zip ? String(zip).replace(/\D/g, '') : undefined;

  let solaResult;
  try {
    solaResult = await solaTokenize(cleanNum, expCombined, cleanCvv, cleanZip);
  } catch (err: any) {
    res.status(502).json({ success: false, error: err?.message || 'Card tokenization failed' });
    return;
  }

  if (solaResult.xResult !== 'A') {
    res.status(400).json({
      success: false,
      error: solaResult.xError || 'Card could not be verified',
    });
    return;
  }

  const last4 = cleanNum.slice(-4);

  const { data: savedCard, error } = await supabaseAdmin
    .from('payment_methods')
    .insert({
      user_id: req.params.id,
      sola_token: solaResult.xToken,
      card_last4: last4,
      card_brand: solaResult.xCardType || null,
      card_exp_month: monthInt,
      card_exp_year: yearInt,
      is_default: !!is_default,
    })
    .select()
    .single();

  if (error || !savedCard) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to save card' });
    return;
  }

  if (is_default) {
    const { error: unsetError } = await supabaseAdmin
      .from('payment_methods')
      .update({ is_default: false })
      .eq('user_id', req.params.id)
      .neq('id', savedCard.id);

    if (unsetError) {
      res.status(500).json({
        success: false,
        error: `Card saved but failed to unset other defaults: ${unsetError.message}`,
      });
      return;
    }
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'create_payment_method',
    entity_type: 'payment_method',
    entity_id: savedCard.id,
    changes: {
      card_last4: last4,
      card_brand: savedCard.card_brand,
      card_exp_month: monthInt,
      card_exp_year: yearInt,
    },
  });

  res.status(201).json({
    success: true,
    data: {
      id: savedCard.id,
      card_last4: savedCard.card_last4,
      card_brand: savedCard.card_brand,
      card_exp_month: savedCard.card_exp_month,
      card_exp_year: savedCard.card_exp_year,
      is_default: savedCard.is_default,
    },
  });
});

usersRouter.patch('/:id/payment-methods/:paymentMethodId', async (req, res) => {
  const { is_default } = req.body;

  const updates: Record<string, unknown> = {};
  if (is_default !== undefined) updates.is_default = !!is_default;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ success: false, error: 'No editable fields provided' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('payment_methods')
    .update(updates)
    .eq('id', req.params.paymentMethodId)
    .eq('user_id', req.params.id)
    .select('id, card_last4, card_brand, card_exp_month, card_exp_year, is_default')
    .single();

  if (error || !data) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to update card' });
    return;
  }

  if (is_default) {
    const { error: unsetError } = await supabaseAdmin
      .from('payment_methods')
      .update({ is_default: false })
      .eq('user_id', req.params.id)
      .neq('id', req.params.paymentMethodId);

    if (unsetError) {
      res.status(500).json({
        success: false,
        error: `Card updated but failed to unset other defaults: ${unsetError.message}`,
      });
      return;
    }
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'update_payment_method',
    entity_type: 'payment_method',
    entity_id: req.params.paymentMethodId,
    changes: updates,
  });

  res.json({ success: true, data });
});

// Statuses where the card may still be needed (re-auth, capture, refund routing).
// Orders outside this list are terminal (`completed`, `failed`, `cancelled`)
// and don't block anything; they keep their card snapshot for display only.
const ACTIVE_ORDER_STATUSES = ['pending', 'processing', 'awaiting_confirmation', 'confirmed'];

usersRouter.get('/:id/payment-methods/:paymentMethodId/usage', async (req, res) => {
  const { count, error } = await supabaseAdmin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('payment_method_id', req.params.paymentMethodId)
    .in('status', ACTIVE_ORDER_STATUSES);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data: { active_order_count: count || 0 } });
});

usersRouter.delete('/:id/payment-methods/:paymentMethodId', async (req, res) => {
  // We don't block deletion when orders reference this card. The orders
  // table already snapshots `card_brand_snapshot` / `card_last4_snapshot`
  // at order creation, and the FK is `ON DELETE SET NULL`, so historical
  // orders keep showing the card details that were used.
  const { error } = await supabaseAdmin
    .from('payment_methods')
    .delete()
    .eq('id', req.params.paymentMethodId)
    .eq('user_id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_user_id: (req as any).adminUser.id,
    action: 'delete_payment_method',
    entity_type: 'payment_method',
    entity_id: req.params.paymentMethodId,
    changes: null,
  });

  res.json({ success: true, message: 'Card deleted' });
});

usersRouter.get('/:id/returns', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('order_returns')
    .select(
      'id, order_id, status, source, item_subtotal_cents, tax_refund_cents, amazon_refund_cents, refunded, created_at, completed_at, orders(created_at), order_return_items(product_name, voicex_id, quantity, unit_price_cents)',
    )
    .eq('user_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const rows = (data || []).map((row: any) => {
    const items = row.order_return_items || [];
    return {
      ...row,
      item_count: items.length,
      total_qty: items.reduce((sum: number, i: any) => sum + i.quantity, 0),
      customer_refund_cents: row.item_subtotal_cents + row.tax_refund_cents,
    };
  });

  res.json({ success: true, data: rows });
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