import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  catalogProductStatusLabel,
  getProductDisplayName,
  getProductPriceCents,
  isCatalogProductStatus,
  type CatalogProduct,
} from '@voicex/shared';
import { formatUsdFromCents } from './product-price';

export interface ProductsListPdfMeta {
  /** Small lines under the title (filters, date, count). */
  subtitleLines?: string[];
}

/** API rows include server-decorated `thumbnail_url`. */
type ProductRow = CatalogProduct & { thumbnail_url?: string | null };

function getMainProductImageUrl(product: ProductRow): string | null {
  const t = product.thumbnail_url;
  if (t && typeof t === 'string' && t.trim()) return t.trim();
  const imgs = product.amazon_image_urls;
  if (!imgs || imgs.length === 0) return null;
  const featured = imgs.find((i) => i.is_featured) ?? imgs[0];
  const u = featured?.url;
  return u && typeof u === 'string' && u.trim() ? u.trim() : null;
}

function guessImageFormatFromDataUrl(dataUrl: string): 'JPEG' | 'PNG' | 'WEBP' {
  const m = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp)/i);
  if (!m) return 'JPEG';
  const t = m[1].toLowerCase();
  if (t === 'png') return 'PNG';
  if (t === 'webp') return 'WEBP';
  return 'JPEG';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

function readNaturalImageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w > 0 && h > 0) resolve({ w, h });
      else reject(new Error('Invalid image dimensions'));
    };
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = dataUrl;
  });
}

type PdfImageSlot = {
  dataUrl: string;
  format: 'JPEG' | 'PNG' | 'WEBP';
  /** Natural pixel size for aspect ratio when drawing. */
  pixelW: number;
  pixelH: number;
};

async function fetchImageForPdf(url: string): Promise<PdfImageSlot | null> {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await blobToDataUrl(blob);
    const format = guessImageFormatFromDataUrl(dataUrl);
    const { w, h } = await readNaturalImageSize(dataUrl);
    return { dataUrl, format, pixelW: w, pixelH: h };
  } catch {
    return null;
  }
}

/**
 * Bounded parallel fetch (many rows; avoid opening hundreds of connections at once).
 *
 * Each worker claims an index in a synchronous critical section, then awaits work.
 * Under ECMAScript run-to-completion, that claim cannot interleave with other workers
 * (unlike preemptive threads); the only suspension points are `await` below.
 */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const cap = Math.min(Math.max(1, limit), Math.max(1, items.length));
  /** Next index to process, or `undefined` when exhausted. No `await` inside — must stay synchronous. */
  const claimIndex = (): number | undefined => {
    const i = next;
    if (i >= items.length) return undefined;
    next += 1;
    return i;
  };
  const worker = async () => {
    for (;;) {
      const i = claimIndex();
      if (i === undefined) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: cap }, () => worker()));
  return results;
}

function formatAmazonPrice(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return formatUsdFromCents(cents);
}

function formatCustomPriceCell(p: CatalogProduct, defaultMarkupPercent: number): string {
  if (p.custom_price_cents != null) return formatUsdFromCents(p.custom_price_cents);
  const computed = getProductPriceCents(p, defaultMarkupPercent, false);
  if (computed != null) return formatUsdFromCents(computed);
  return '—';
}

function formatLocalPrice(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return formatUsdFromCents(cents);
}

const THUMB_FETCH_CONCURRENCY = 8;
/** Max longer edge (mm) inside image cell — portrait uses a narrower image column than landscape. */
const THUMB_MAX_EDGE_MM = 12;

/** Fit `pixelW:pixelH` inside `innerW`×`innerH` (mm), preserve aspect ratio, cap longer edge. */
function fitImageDrawMm(
  innerW: number,
  innerH: number,
  pixelW: number,
  pixelH: number,
  maxLongEdgeMm: number,
): { drawW: number; drawH: number } {
  const pw = Math.max(1, pixelW);
  const ph = Math.max(1, pixelH);
  const ar = pw / ph;
  let drawW = innerW;
  let drawH = innerW / ar;
  if (drawH > innerH) {
    drawH = innerH;
    drawW = innerH * ar;
  }
  const longEdge = Math.max(drawW, drawH);
  if (longEdge > maxLongEdgeMm && longEdge > 0) {
    const s = maxLongEdgeMm / longEdge;
    drawW *= s;
    drawH *= s;
  }
  return { drawW, drawH };
}

/**
 * Loads main image per product (thumbnail URL, else featured/first Amazon URL), then builds a PDF.
 * Images that fail CORS or network appear as empty cells.
 */
export async function buildProductsListPdfBlob(
  products: CatalogProduct[],
  defaultMarkupPercent: number,
  meta?: ProductsListPdfMeta,
): Promise<Blob> {
  const imageCells = await mapWithConcurrency(products, THUMB_FETCH_CONCURRENCY, async (p) => {
    const url = getMainProductImageUrl(p as ProductRow);
    if (!url) return null;
    return fetchImageForPdf(url);
  });

  /** US Letter (8.5×11 in) — typical for US clients; jsPDF accepts `format: 'letter'`. */
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  doc.setFontSize(16);
  doc.text('Products', 14, 12);

  let y = 18;
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  const lines = meta?.subtitleLines?.filter(Boolean) ?? [];
  for (const line of lines) {
    doc.text(line, 14, y);
    y += 4;
  }
  doc.setTextColor(0, 0, 0);

  const head = [
    ['Image', 'VoiceX ID', 'Name', 'ASIN', 'Amazon $', 'Custom $', 'Local $', 'Status', 'Lifetime sold'],
  ];
  const body = products.map((p) => [
    '',
    p.voicex_id ?? '',
    getProductDisplayName(p),
    p.amazon_asin ?? '',
    formatAmazonPrice(p.amazon_price_cents),
    formatCustomPriceCell(p, defaultMarkupPercent),
    formatLocalPrice(p.local_price_cents),
    catalogProductStatusLabel(isCatalogProductStatus(p.status) ? p.status : 'inactive'),
    String(p.lifetime_qty_sold ?? 0),
  ]);

  autoTable(doc, {
    head,
    body,
    startY: y + 2,
    styles: { fontSize: 6.5, cellPadding: 1, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', fontSize: 6.5 },
    bodyStyles: { minCellHeight: 14 },
    columnStyles: {
      // ~188mm content width on Letter portrait (~215.9mm − 28mm margins)
      0: { cellWidth: 16, halign: 'center', valign: 'middle' },
      1: { cellWidth: 16 },
      2: { cellWidth: 71 },
      3: { cellWidth: 18 },
      4: { cellWidth: 15 },
      5: { cellWidth: 15 },
      6: { cellWidth: 15 },
      7: { cellWidth: 10 },
      8: { cellWidth: 12 },
    },
    margin: { left: 14, right: 14 },
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 0) return;
      const slot = imageCells[data.row.index];
      if (!slot) return;
      const pl = data.cell.padding('left');
      const pr = data.cell.padding('right');
      const pt = data.cell.padding('top');
      const pb = data.cell.padding('bottom');
      const innerW = data.cell.width - pl - pr;
      const innerH = data.cell.height - pt - pb;
      const { drawW, drawH } = fitImageDrawMm(
        innerW,
        innerH,
        slot.pixelW,
        slot.pixelH,
        THUMB_MAX_EDGE_MM,
      );
      const x = data.cell.x + pl + (innerW - drawW) / 2;
      const y0 = data.cell.y + pt + (innerH - drawH) / 2;
      try {
        data.doc.addImage(slot.dataUrl, slot.format, x, y0, drawW, drawH);
      } catch {
        // Unsupported format or corrupt data — leave cell empty
      }
    },
  });

  return doc.output('blob');
}
