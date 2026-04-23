import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ImageOff } from 'lucide-react';

export interface LightboxImage {
  url: string;
  is_featured: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  images: LightboxImage[];
  alt?: string;
}

/**
 * Modal lightbox for browsing the full Amazon image gallery for a product.
 *
 * Amazon image URLs are NOT loaded until this lightbox is mounted (which only
 * happens when `open` becomes true), so it has zero impact on the underlying
 * page's load time / bandwidth.
 */
export function ProductImageLightbox({ open, onClose, images, alt }: Props) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    const featuredIdx = images.findIndex((img) => img.is_featured);
    setIndex(featuredIdx >= 0 ? featuredIdx : 0);
  }, [open, images]);

  const next = useCallback(() => {
    setIndex((i) => (images.length === 0 ? 0 : (i + 1) % images.length));
  }, [images.length]);

  const prev = useCallback(() => {
    setIndex((i) => (images.length === 0 ? 0 : (i - 1 + images.length) % images.length));
  }, [images.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, next, prev]);

  if (!open) return null;

  const current = images[index];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        title="Close (Esc)"
      >
        <X size={20} />
      </button>

      {images.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
          title="Previous (←)"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      {images.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
          title="Next (→)"
        >
          <ChevronRight size={24} />
        </button>
      )}

      <div
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {current ? (
          <img
            src={current.url}
            alt={alt || `Product image ${index + 1}`}
            className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            loading="eager"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-lg bg-white/10 text-white">
            <ImageOff size={32} />
            <span className="text-sm">No images available</span>
          </div>
        )}

        {images.length > 1 && (
          <div className="flex items-center gap-3 rounded-full bg-white/10 px-4 py-2 text-sm text-white">
            <span>
              {index + 1} / {images.length}
            </span>
          </div>
        )}

        {images.length > 1 && (
          <div className="flex max-w-[90vw] gap-2 overflow-x-auto px-2 pb-2">
            {images.map((img, i) => (
              <button
                key={img.url + i}
                type="button"
                onClick={() => setIndex(i)}
                className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded border-2 ${
                  i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100'
                }`}
              >
                <img
                  src={img.url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
