import { supabaseAdmin } from './supabase.js';
import { config } from '../config.js';

const BUCKET = 'ivr-audio';

/**
 * Allowed audio content types and the file extension we store them under.
 * Kept deliberately small (MP3 / WAV / M4A / OGG) — these are what TelTech's
 * `play` action reliably handles. WAV is the safest for telephony; MP3 is the
 * most convenient for admins recording on a phone.
 */
const CONTENT_TYPE_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg',
};

/** Returns the stored file extension for an audio content type, or null if unsupported. */
export function extForAudioContentType(contentType: string | undefined | null): string | null {
  if (!contentType) return null;
  const base = contentType.split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[base] ?? null;
}

/** Builds the fully-qualified public URL for a stored IVR audio path, or null. */
export function getIvrAudioPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = config.supabase.url.replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * Uploads an IVR prompt recording for a node and returns its storage path and
 * public URL. Files are namespaced per node (`<nodeId>/prompt-<ts>.<ext>`); the
 * timestamp also busts any CDN cache when a recording is replaced.
 */
export async function uploadIvrAudio(
  nodeId: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ path: string; url: string }> {
  const ext = extForAudioContentType(contentType) ?? 'mp3';
  const path = `${nodeId}/prompt-${Date.now()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) {
    throw new Error(error.message);
  }

  return { path, url: getIvrAudioPublicUrl(path)! };
}

/** Removes a stored IVR prompt recording. */
export async function deleteIvrAudio(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) {
    throw new Error(error.message);
  }
}
