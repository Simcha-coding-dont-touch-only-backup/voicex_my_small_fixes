import { useEffect, useState } from 'react';
import { CatalogProductStatusBadge } from './CatalogProductStatusBadge';
import { CustomPriceReadonlyDisplay } from '../lib/product-price';
import { ProductImageLightbox, type LightboxImage } from './ProductImageLightbox';
import { apiGet } from '../lib/api';

const DETAIL_IMAGE_SIZE = 96;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ProductDetailView({
  product,
  defaultMarkupPercent,
}: {
  product: any;
  defaultMarkupPercent: number;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [subStats, setSubStats] = useState<{ quantity: number; deliveries: number; subscribers: number } | null>(null);
  const imageAlt = product.voice_name || product.amazon_name || product.voicex_id;

  useEffect(() => {
    if (!product.id) return;
    let cancelled = false;
    apiGet<any>(`/catalog/products/${product.id}/subscriptions`)
      .then((res) => { if (!cancelled) setSubStats(res.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [product.id]);
  const galleryImages: LightboxImage[] = product.amazon_image_urls ?? [];
  const featuredImage = galleryImages.find((img) => img.is_featured) ?? galleryImages[0];
  const previewUrl = featuredImage?.url ?? product.thumbnail_url;
  const canOpenGallery = galleryImages.length > 0;

  return (
    <div className="space-y-5 text-sm">
      {previewUrl && (
        <div>
          <h4 className="mb-2 text-xs font-medium text-gray-500">Images</h4>
          <button
            type="button"
            disabled={!canOpenGallery}
            onClick={() => canOpenGallery && setLightboxOpen(true)}
            className={`group relative flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 ${
              canOpenGallery ? 'cursor-zoom-in hover:border-indigo-400 hover:shadow' : 'cursor-default'
            }`}
            style={{ width: DETAIL_IMAGE_SIZE, height: DETAIL_IMAGE_SIZE }}
            title={canOpenGallery ? 'Click to view all images' : 'Product image'}
          >
            <img src={previewUrl} alt={imageAlt} className="h-full w-full object-cover" loading="lazy" />
            {galleryImages.length > 1 && (
              <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl bg-black/55 px-1 text-[10px] font-medium text-white">
                {galleryImages.length}
              </span>
            )}
          </button>
          {galleryImages.length > 1 && (
            <p className="mt-2 text-xs text-gray-500">Click to view all {galleryImages.length} images</p>
          )}
          {lightboxOpen && (
            <ProductImageLightbox
              open={lightboxOpen}
              onClose={() => setLightboxOpen(false)}
              images={galleryImages}
              alt={imageAlt}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div>
          <dt className="font-medium text-blue-600">VoiceX ID</dt>
          <dd className="mt-0.5">{product.voicex_id}</dd>
        </div>
        <div>
          <dt className="font-medium text-blue-600">ASIN</dt>
          <dd className="mt-0.5">{product.amazon_asin}</dd>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h4 className="mb-3 text-sm font-semibold text-indigo-600 uppercase tracking-wide">VoiceX</h4>
          <dl className="space-y-3">
            <div>
              <dt className="font-medium text-blue-600">Name</dt>
              <dd className="mt-0.5">{product.voice_name || <span className="text-gray-300">—</span>}</dd>
            </div>
            <div>
              <dt className="font-medium text-blue-600">Description</dt>
              <dd className="mt-0.5">{product.voice_description || <span className="text-gray-300">—</span>}</dd>
            </div>
            <div>
              <dt className="font-medium text-blue-600">Price</dt>
              <dd className="mt-0.5">
                <CustomPriceReadonlyDisplay
                  product={product}
                  defaultMarkupPercent={defaultMarkupPercent}
                  whenEmpty={<span className="text-gray-300">—</span>}
                  showMarkupExplanation
                />
              </dd>
            </div>
            <div>
              <dt className="font-medium text-blue-600">Local Store Price</dt>
              <dd className="mt-0.5">
                {product.local_price_cents != null
                  ? `$${(product.local_price_cents / 100).toFixed(2)}`
                  : <span className="text-gray-300">—</span>}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-semibold text-orange-600 uppercase tracking-wide">Amazon</h4>
          <dl className="space-y-3">
            <div>
              <dt className="font-medium text-blue-600">Name</dt>
              <dd className="mt-0.5">{product.amazon_name || <span className="text-gray-300">—</span>}</dd>
            </div>
            <div>
              <dt className="font-medium text-blue-600">Description</dt>
              <dd className="mt-0.5">{product.amazon_description || <span className="text-gray-300">—</span>}</dd>
            </div>
            <div>
              <dt className="font-medium text-blue-600">Price</dt>
              <dd className="mt-0.5">
                {product.amazon_price_cents
                  ? `$${(product.amazon_price_cents / 100).toFixed(2)}`
                  : <span className="text-gray-300">—</span>}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="border-t pt-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <dt className="font-medium text-blue-600">Status</dt>
            <dd className="mt-0.5">
              <CatalogProductStatusBadge
                status={product.status}
                frozenSource={product.frozen_source}
                stacked
              />
            </dd>
          </div>
          <div>
            <dt className="font-medium text-blue-600">Lifetime Sold</dt>
            <dd className="mt-0.5">{product.lifetime_qty_sold}</dd>
          </div>
          <div>
            <dt className="font-medium text-blue-600">Date Added</dt>
            <dd className="mt-0.5 text-gray-700">{formatDate(product.created_at)}</dd>
          </div>
          <div>
            <dt className="font-medium text-blue-600">Last Edited</dt>
            <dd className="mt-0.5 text-gray-700">{formatDate(product.updated_at)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="font-medium text-blue-600">Categories</dt>
            <dd className="mt-0.5">
              {product.catalog_product_categories?.map((c: any) => c.catalog_categories?.name).join(', ') || '-'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="border-t pt-4">
        <h4 className="mb-3 text-sm font-semibold text-indigo-600 uppercase tracking-wide">Subscriptions</h4>
        <dl className="grid grid-cols-3 gap-x-6">
          <div>
            <dt className="font-medium text-blue-600">Quantity</dt>
            <dd className="mt-0.5">{subStats ? subStats.quantity : '—'}</dd>
          </div>
          <div>
            <dt className="font-medium text-blue-600">Deliveries</dt>
            <dd className="mt-0.5">{subStats ? subStats.deliveries : '—'}</dd>
          </div>
          <div>
            <dt className="font-medium text-blue-600">Subscribers</dt>
            <dd className="mt-0.5">{subStats ? subStats.subscribers : '—'}</dd>
          </div>
        </dl>
        <p className="mt-1 text-xs text-gray-400">Across all currently active weekly deliveries.</p>
      </div>
    </div>
  );
}
