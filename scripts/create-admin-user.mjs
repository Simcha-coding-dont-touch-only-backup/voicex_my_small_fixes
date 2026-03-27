/**
 * Creates a Supabase Auth user and links them in public.admin_users (required for API admin routes).
 *
 * Usage (from repo root):
 *   node --env-file=.env scripts/create-admin-user.mjs <email> <password> [displayName]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
const password = process.argv[3];
const name = process.argv[4] || email?.split('@')[0] || 'Admin';

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

if (!email || !password) {
  console.error(
    'Usage: node --env-file=.env scripts/create-admin-user.mjs <email> <password> [displayName]'
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthUserIdByEmail() {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

let userId;

const { data: created, error: createErr } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (createErr) {
  const msg = createErr.message?.toLowerCase() ?? '';
  if (
    msg.includes('already') ||
    msg.includes('registered') ||
    msg.includes('exists')
  ) {
    userId = await findAuthUserIdByEmail();
    if (!userId) {
      console.error('User may exist but could not be resolved:', createErr.message);
      process.exit(1);
    }
    console.log('Auth user already exists; linking admin_users row…');
  } else {
    console.error(createErr.message);
    process.exit(1);
  }
} else {
  userId = created.user.id;
  console.log('Auth user created.');
}

const { data: existing } = await supabase
  .from('admin_users')
  .select('id')
  .eq('id', userId)
  .maybeSingle();

if (existing) {
  console.log('admin_users row already present. Done:', email);
  process.exit(0);
}

const { error: insertErr } = await supabase.from('admin_users').insert({
  id: userId,
  email,
  name,
  role: 'admin',
});

if (insertErr) {
  console.error('admin_users insert failed:', insertErr.message);
  process.exit(1);
}

console.log('Admin linked:', email, '(name:', name + ')');
