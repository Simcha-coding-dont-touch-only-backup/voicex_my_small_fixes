import { supabaseAdmin } from './supabase.js';
import { config } from '../config.js';

const BUCKET = 'product-images';

export interface ProductImageInput {
  url: string;
  is_featured: boolean;
}

/**
 * Returns the featured image URL from a list, falling back to the first image
 * if no image is explicitly marked featured.
 */
export function pickFeaturedImageUrl(images: ProductImageInput[] | null | undefined): string | null {
  if (!images || images.length === 0) return null;
  const featured = images.find((img) => img.is_featured);
  return (featured ?? images[0]).url;
}

function guessExtensionFromContentType(contentType: string | null): string {
  if (!contentType) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

/**
 * Downloads the featured Amazon image and uploads it to the `product-images`
 * bucket under `<asin>/featured.<ext>`. Returns the storage path on success
 * or null on any failure (best-effort — we don't want missing images to block
 * product creation).
 */
export async function downloadAndStoreFeaturedThumbnail(
  asin: string,
  featuredUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(featuredUrl, {
      headers: {
        // Some Amazon CDNs 403 without a UA
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    });
    if (!res.ok) {
      console.warn(`[product-images] Failed to download ${featuredUrl}: ${res.status}`);
      return null;
    }
    const contentType = res.headers.get('content-type');
    const ext = guessExtensionFromContentType(contentType);
    const buffer = Buffer.from(await res.arrayBuffer());

    const path = `${asin.toUpperCase()}/featured.${ext}`;
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: contentType ?? 'image/jpeg',
        upsert: true,
      });
    if (error) {
      console.warn(`[product-images] Upload failed for ${path}:`, error.message);
      return null;
    }
    return path;
  } catch (err) {
    console.warn('[product-images] Unexpected error downloading thumbnail:', err);
    return null;
  }
}

/**
 * Returns a fully-qualified public URL for a stored thumbnail path, or null if
 * no path. Used when serving product rows back to the admin UI.
 */
export function getThumbnailPublicUrl(thumbnailPath: string | null | undefined): string | null {
  if (!thumbnailPath) return null;
  const base = config.supabase.url.replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/${thumbnailPath}`;
}

/**
 * Removes any stored objects under <asin>/. Best-effort — used when an ASIN
 * changes on update so we don't accumulate orphan files.
 */
export async function deleteThumbnailsForAsin(asin: string): Promise<void> {
  try {
    const prefix = `${asin.toUpperCase()}/`;
    const { data: objects } = await supabaseAdmin.storage.from(BUCKET).list(prefix);
    if (!objects || objects.length === 0) return;
    const paths = objects.map((o) => `${prefix}${o.name}`);
    await supabaseAdmin.storage.from(BUCKET).remove(paths);
  } catch {
    // best-effort cleanup
  }
}
