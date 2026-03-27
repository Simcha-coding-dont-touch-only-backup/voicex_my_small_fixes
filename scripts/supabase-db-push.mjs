#!/usr/bin/env node
/**
 * Pushes supabase/migrations to the linked remote project.
 * Requires a one-time: supabase link --project-ref <ref> -p "$SUPABASE_DB_PASSWORD" --yes
 * Run: npm run db:migrate  (loads .env via package.json)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.SUPABASE_DB_PASSWORD?.trim()) {
  console.error(
    'Missing SUPABASE_DB_PASSWORD. Set it in .env (Dashboard → Project Settings → Database).'
  );
  process.exit(1);
}

const result = spawnSync('supabase', ['db', 'push', '--yes'], {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
});

process.exit(result.status ?? 1);
