/**
 * Vercel Express entry — re-exports the VoiceX API app so /api/* routes are served.
 * @see https://vercel.com/docs/frameworks/backend/express
 */
import app from '../apps/api/src/server.js';
export default app;
