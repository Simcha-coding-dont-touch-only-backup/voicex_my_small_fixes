import { useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { ProductImageLightbox, type LightboxImage } from './ProductImageLightbox';

interface Props {
  /**
   * Stored thumbnail URL (already a public Supabase Storage URL on our domain).
   * Loads with the page row — small file, our CDN, no Amazon dependency.
   */
  thumbnailUrl: string | null | undefined;
  /**
   * Full Amazon image gallery. NOT loaded until the lightbox is opened —
   * the URLs only get used when the user actually clicks the thumbnail.
   */
  images: LightboxImage[] | null | undefined;
  alt?: string;
  size?: number;
}

export function ProductThumbnail({ thumbnailUrl, images, alt, size = 48 }: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const galleryImages = images ?? [];
  const canOpen = galleryImages.length > 0;

  return (
    <>
      <button
        type="button"
        disabled={!canOpen}
        onClick={(e) => {
          e.stopPropagation();
          if (canOpen) setLightboxOpen(true);
        }}
        className={`group relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50 ${
          canOpen ? 'cursor-zoom-in hover:border-indigo-400 hover:shadow' : 'cursor-default'
        }`}
        style={{ width: size, height: size }}
        title={canOpen ? 'Click to view all images' : 'No image'}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={alt || 'Product thumbnail'}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <ImageIcon size={Math.max(16, Math.floor(size / 2.5))} className="text-gray-300" />
        )}
        {canOpen && galleryImages.length > 1 && (
          <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl bg-black/55 px-1 text-[10px] font-medium text-white">
            {galleryImages.length}
          </span>
        )}
      </button>

      {lightboxOpen && (
        <ProductImageLightbox
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          images={galleryImages}
          alt={alt}
        />
      )}
    </>
  );
}
