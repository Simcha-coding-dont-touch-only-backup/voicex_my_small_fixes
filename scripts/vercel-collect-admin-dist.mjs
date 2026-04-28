/**
 * Vercel: monorepo root has outputDirectory "dist". Vite emits to
 * apps/admin-web/dist; copy that folder to the repo root dist/ after build.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const from = path.join(root, 'apps', 'admin-web', 'dist');
const to = path.join(root, 'dist');
const index = path.join(from, 'index.html');

if (!existsSync(index)) {
  console.error(`vercel: missing ${index} — did the build run?`);
  process.exit(1);
}

if (existsSync(to)) {
  rmSync(to, { recursive: true, force: true });
}
cpSync(from, to, { recursive: true });
console.log(`vercel: copied static output ${from} -> ${to}`);
