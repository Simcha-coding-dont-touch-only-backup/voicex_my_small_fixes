/**
 * Vercel Express entry — re-exports the VoiceX API app so /api/* routes are served.
 * In the Vercel dashboard, set Root Directory to this monorepo root (not apps/admin-web).
 * @see https://vercel.com/docs/frameworks/backend/express
 */
export { default } from '../apps/api/src/server.js';
