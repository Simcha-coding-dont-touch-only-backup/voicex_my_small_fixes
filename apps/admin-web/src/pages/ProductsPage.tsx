import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { CustomPriceReadonlyDisplay, customPriceInputPlaceholder } from '../lib/product-price';
import { Search, Plus, Pencil, Trash2, Trash, X, Loader2, ExternalLink, AlertTriangle, Printer, Upload, Eye, Tags, ToggleLeft, ArrowRight } from 'lucide-react';
import { SearchableMultiSelect } from '../components/SearchableMultiSelect';
import { FilterSingleSelect } from '../components/FilterSingleSelect';
import { CategoryQuickCreateModal } from '../components/CategoryQuickCreateModal';
import { ImportProductsFlow } from '../components/ImportProductsFlow';
import { ProductThumbnail } from '../components/ProductThumbnail';
import { ProductDetailView } from '../components/ProductDetailView';
import { buildProductsListPdfBlob } from '../lib/products-list-pdf';
import {
  catalogProductStatusBadgeClass,
  catalogProductStatusLabel,
  getProductPriceCents,
  isCatalogProductStatus,
  type CatalogProduct,
  type CatalogProductStatus,
} from '@voicex/shared';
import { EndlessTail, PaginationFooter, SortHeader, useAdminTableQuery } from '../components/admin-table';

interface AsinLookupData {
  asin: string;
  url: string;
  name: string | null;
  description: string | null;
  price_cents: number | null;
  currency: string;
  availability: string;
  is_purchasable: boolean;
  images: { url: string; is_featured: boolean }[];
  brand: string | null;
}

const ASIN_TOKEN = /^[A-Z0-9]{10}$/;

type CreateProductOverrides = {
  voice_name: string;
  voice_description: string;
  custom_price_cents: string;
  local_price_cents: string;
  category_ids: string[];
};

function emptyCreateOverrides(): CreateProductOverrides {
  return { voice_name: '', voice_description: '', custom_price_cents: '', local_price_cents: '', category_ids: [] };
}

const PRODUCTS_TABLE_CELL = 'px-3 py-2';
const PRODUCTS_TABLE_HEADER = `${PRODUCTS_TABLE_CELL} font-medium`;

function getProductCategoryNames(p: {
  catalog_product_categories?: { catalog_categories?: { name?: string | null } | null }[] | null;
}): string[] {
  return (p.catalog_product_categories ?? [])
    .map((link) => link.catalog_categories?.name?.trim())
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => a.localeCompare(b));
}

function ProductCategoryLabels({ product }: { product: { catalog_product_categories?: { catalog_categories?: { name?: string | null } | null }[] | null } }) {
  const names = getProductCategoryNames(product);
  if (names.length === 0) return <>—</>;
  return (
    <>
      {names.map((name, i) => (
        <span key={name} className="block hover:underline">
          {name}
          {i < names.length - 1 ? ',' : ''}
        </span>
      ))}
    </>
  );
}

/** Split on non-alphanumeric delimiters; keep first-seen order; dedupe. */
function parseAsinsFromText(text: string): string[] {
  const upper = text.toUpperCase();
  const parts = upper.split(/[^A-Z0-9]+/).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (p.length === 10 && ASIN_TOKEN.test(p) && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function dedupeOrderedAppend(base: string[], extra: string[]): string[] {
  const seen = new Set(base);
  const result = [...base];
  for (const a of extra) {
    if (!seen.has(a)) {
      seen.add(a);
      result.push(a);
    }
  }
  return result;
}

const BULK_LOOKUP_CONCURRENCY = 4;

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const n = items.length;
  if (n === 0) return;
  const pool = Math.min(Math.max(1, limit), n);
  async function run() {
    for (;;) {
      const idx = cursor++;
      if (idx >= n) break;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: pool }, () => run()));
}

type QuickCategoryTarget = 'create' | 'edit' | { type: 'bulk'; rowId: string } | { type: 'inline' } | null;

function buildCategoryLinks(categoryIds: string[], categories: { id: string; name: string }[]) {
  return categoryIds.map((cid) => {
    const cat = categories.find((c) => c.id === cid);
    return { category_id: cid, catalog_categories: cat ? { name: cat.name } : null };
  });
}

function CategoryInlineEditor({
  open,
  anchorEl,
  categories,
  draftIds,
  saving,
  onDraftChange,
  onSave,
  onCancel,
  onQuickCategoryNew,
  saveError,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  categories: { id: string; name: string }[];
  draftIds: string[];
  saving: boolean;
  onDraftChange: (ids: string[]) => void;
  onSave: () => void;
  onCancel: () => void;
  onQuickCategoryNew: () => void;
  saveError?: string | null;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const popupW = 320;
      const popupH = 220;
      let left = rect.left;
      if (left + popupW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - popupW - 8);
      let top = rect.bottom + 6;
      if (top + popupH > window.innerHeight - 8) top = Math.max(8, rect.top - popupH - 6);
      setPos({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorEl?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      if (document.querySelector('[data-category-quick-create-modal]')?.contains(target)) return;
      onCancel();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, anchorEl, onCancel]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={popupRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[9999] w-80 rounded-lg border border-indigo-200 bg-white p-4 shadow-xl"
      role="dialog"
      aria-label="Edit categories"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Categories</span>
        <button
          type="button"
          onClick={onQuickCategoryNew}
          className="flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
          title="Create new category"
        >
          <Plus size={12} /> New
        </button>
      </div>
      <SearchableMultiSelect
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
        value={draftIds}
        onChange={onDraftChange}
        placeholder="Select categories..."
        className="[&>button]:mt-0"
      />
      {saveError ? (
        <p className="mt-2 text-sm text-red-600">{saveError}</p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="rounded border px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}

const PRODUCT_STATUS_OPTIONS: CatalogProductStatus[] = ['active', 'inactive', 'frozen'];

function ProductStatusRadioGroup({
  name,
  value,
  onChange,
}: {
  name: string;
  value: CatalogProductStatus;
  onChange: (status: CatalogProductStatus) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {PRODUCT_STATUS_OPTIONS.map((status) => (
        <label key={status} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            checked={value === status}
            onChange={() => onChange(status)}
          />
          <span className={`rounded-full px-2 py-0.5 text-xs ${catalogProductStatusBadgeClass(status)}`}>
            {catalogProductStatusLabel(status)}
          </span>
        </label>
      ))}
    </div>
  );
}

function StatusInlineEditor({
  open,
  anchorEl,
  draftStatus,
  saving,
  onDraftChange,
  onSave,
  onCancel,
  saveError,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  draftStatus: CatalogProductStatus;
  saving: boolean;
  onDraftChange: (status: CatalogProductStatus) => void;
  onSave: () => void;
  onCancel: () => void;
  saveError?: string | null;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const popupW = 240;
      const popupH = 200;
      let left = rect.left;
      if (left + popupW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - popupW - 8);
      let top = rect.bottom + 6;
      if (top + popupH > window.innerHeight - 8) top = Math.max(8, rect.top - popupH - 6);
      setPos({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorEl?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      onCancel();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, anchorEl, onCancel]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={popupRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[9999] w-60 rounded-lg border border-indigo-200 bg-white p-4 shadow-xl"
      role="dialog"
      aria-label="Edit status"
    >
      <span className="mb-3 block text-sm font-medium text-gray-700">Status</span>
      <ProductStatusRadioGroup
        name="product-status-inline"
        value={draftStatus}
        onChange={onDraftChange}
      />
      {saveError ? (
        <p className="mt-2 text-sm text-red-600">{saveError}</p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="rounded border px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}

type ProductStatusFilter = 'all' | 'active' | 'inactive' | 'frozen';

type BulkProductRow = {
  id: string;
  asin: string;
  lookupData: AsinLookupData | null;
  lookupError: string;
  lookupLoading: boolean;
  overrides: CreateProductOverrides;
  saving: boolean;
};

function CreateFromLookupPanel({
  lookupData,
  overrides,
  onOverridesChange,
  categories,
  defaultMarkupPercent,
  onQuickCategoryNew,
  onCreate,
  onRowCancel,
  saving,
  createDisabled,
}: {
  lookupData: AsinLookupData;
  overrides: CreateProductOverrides;
  onOverridesChange: (next: CreateProductOverrides) => void;
  categories: any[];
  defaultMarkupPercent: number;
  onQuickCategoryNew: () => void;
  onCreate: () => void;
  onRowCancel: () => void;
  saving: boolean;
  createDisabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-4 grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-3 text-sm font-semibold text-gray-700">Amazon Data (auto-fetched)</h4>
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            {lookupData.images && lookupData.images.length > 0 && (
              <div className="flex items-start gap-3">
                <ProductThumbnail
                  thumbnailUrl={(lookupData.images.find((i) => i.is_featured) || lookupData.images[0])?.url || null}
                  images={lookupData.images}
                  alt={lookupData.name || lookupData.asin}
                  size={88}
                />
                <div className="text-xs text-gray-500">
                  {lookupData.images.length} image{lookupData.images.length === 1 ? '' : 's'} found.
                  <br />
                  The featured one will be saved as a thumbnail; click to preview the full gallery.
                </div>
              </div>
            )}
            <div>
              <span className="text-xs font-medium text-gray-500">Name</span>
              <p className="text-sm text-gray-800">{lookupData.name || '-'}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500">Description</span>
              <p className="text-sm text-gray-800 max-h-24 overflow-y-auto">
                {lookupData.description
                  ? lookupData.description.substring(0, 300) + (lookupData.description.length > 300 ? '...' : '')
                  : '-'}
              </p>
            </div>
            <div className="flex gap-6">
              <div>
                <span className="text-xs font-medium text-gray-500">Price</span>
                <p className="text-sm font-semibold text-gray-800">
                  {lookupData.price_cents != null ? `$${(lookupData.price_cents / 100).toFixed(2)}` : '-'}
                </p>
              </div>
              <div>
                <span className="text-xs font-medium text-gray-500">Availability</span>
                <p className="text-sm">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                      lookupData.availability === 'in_stock'
                        ? 'bg-green-100 text-green-700'
                        : lookupData.availability === 'out_of_stock'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {lookupData.availability.replace(/_/g, ' ')}
                  </span>
                </p>
              </div>
              {lookupData.brand && (
                <div>
                  <span className="text-xs font-medium text-gray-500">Brand</span>
                  <p className="text-sm text-gray-800">{lookupData.brand}</p>
                </div>
              )}
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500">ASIN</span>
              <p className="text-sm font-mono text-gray-600">{lookupData.asin}</p>
            </div>
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-semibold text-gray-700">
            VoiceX Overrides <span className="font-normal text-gray-400">(optional)</span>
          </h4>
          <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
            <div>
              <label className="text-xs font-medium text-gray-500">Custom Name</label>
              <input
                value={overrides.voice_name}
                onChange={(e) => onOverridesChange({ ...overrides, voice_name: e.target.value })}
                placeholder={lookupData.name || 'Leave blank to use Amazon name'}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Custom Description</label>
              <textarea
                value={overrides.voice_description}
                onChange={(e) => onOverridesChange({ ...overrides, voice_description: e.target.value })}
                placeholder="Leave blank to use Amazon description"
                rows={3}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Custom Price (cents)</label>
              <input
                type="number"
                value={overrides.custom_price_cents}
                onChange={(e) => onOverridesChange({ ...overrides, custom_price_cents: e.target.value })}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                placeholder={customPriceInputPlaceholder(lookupData.price_cents, defaultMarkupPercent)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Local Store Price (cents, optional)</label>
              <input
                type="number"
                value={overrides.local_price_cents}
                onChange={(e) => onOverridesChange({ ...overrides, local_price_cents: e.target.value })}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                placeholder="e.g. 1299 for $12.99"
                className="mt-1 w-full rounded border px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <p className="text-xs text-gray-400">If left blank, calls will use the Amazon data shown on the left.</p>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-600">Categories</label>
          <button
            type="button"
            onClick={onQuickCategoryNew}
            className="flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
            title="Create new category"
          >
            <Plus size={12} /> New
          </button>
        </div>
        <SearchableMultiSelect
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={overrides.category_ids}
          onChange={(ids) => onOverridesChange({ ...overrides, category_ids: ids })}
          placeholder="Select categories..."
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCreate}
          disabled={saving || createDisabled}
          className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create Product'}
        </button>
        <button type="button" onClick={onRowCancel} className="rounded border px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

const PRODUCT_PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500, 1000] as const;
const PDF_EXPORT_PER_PAGE = 1000;

function buildEditForm(p: any) {
  return {
    voicex_id: p.voicex_id || '',
    amazon_asin: p.amazon_asin || '',
    amazon_url: p.amazon_url || '',
    amazon_name: p.amazon_name || '',
    amazon_description: p.amazon_description || '',
    amazon_price_cents: p.amazon_price_cents ?? '',
    voice_name: p.voice_name || '',
    voice_description: p.voice_description || '',
    custom_price_cents: p.custom_price_cents ?? '',
    local_price_cents: p.local_price_cents ?? '',
    status: isCatalogProductStatus(p.status) ? p.status : 'inactive',
    category_ids: p.catalog_product_categories?.map((c: any) => c.category_id) || [],
  };
}

function isProductVoicexPriceAboveLocal(p: CatalogProduct | Record<string, unknown>, defaultMarkupPercent: number) {
  const effective = getProductPriceCents(p as CatalogProduct, defaultMarkupPercent, false);
  const local = (p as CatalogProduct).local_price_cents;
  return effective != null && local != null && effective > local;
}

export function ProductsPage() {
  const { isSuperAdmin } = useAuth();
  const isSuper = isSuperAdmin();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [defaultMarkupPercent, setDefaultMarkupPercent] = useState(15);
  const [asinInput, setAsinInput] = useState('');
  const [lookupData, setLookupData] = useState<AsinLookupData | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [createOverrides, setCreateOverrides] = useState<CreateProductOverrides>(emptyCreateOverrides());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewProduct, setViewProduct] = useState<any>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [quickCategoryTarget, setQuickCategoryTarget] = useState<QuickCategoryTarget>(null);
  const [categoryPopupProductId, setCategoryPopupProductId] = useState<string | null>(null);
  const [categoryEditDraft, setCategoryEditDraft] = useState<string[]>([]);
  const [categoryAnchorEl, setCategoryAnchorEl] = useState<HTMLElement | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);
  const [categorySaveError, setCategorySaveError] = useState<string | null>(null);
  const [statusPopupProductId, setStatusPopupProductId] = useState<string | null>(null);
  const [statusEditDraft, setStatusEditDraft] = useState<CatalogProductStatus>('active');
  const [statusAnchorEl, setStatusAnchorEl] = useState<HTMLElement | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusSaveError, setStatusSaveError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<ProductStatusFilter>('all');
  const [addProductMode, setAddProductMode] = useState<'single' | 'bulk'>('single');
  const [bulkAsinChips, setBulkAsinChips] = useState<string[]>([]);
  const [bulkPasteBuffer, setBulkPasteBuffer] = useState('');
  const [bulkPhase, setBulkPhase] = useState<'input' | 'results'>('input');
  const [bulkRows, setBulkRows] = useState<BulkProductRow[]>([]);
  const [bulkLookupRunning, setBulkLookupRunning] = useState(false);
  const [bulkInputError, setBulkInputError] = useState('');
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([]);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const table = useAdminTableQuery<any>({
    defaultSort: { field: 'created_at', dir: 'desc' },
    defaultPerPage: 20,
    filterKey: `${search}|${filterCategoryIds.join(',')}|${filterStatus}`,
    fetcher: ({ page, perPage, sortBy, sortDir }) => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (search) params.set('search', search);
      if (filterCategoryIds.length > 0) params.set('category_ids', filterCategoryIds.join(','));
      if (filterStatus !== 'all') params.set('status', filterStatus);
      return apiGet<any>(`/catalog/products?${params}`).then((r) => ({
        data: r.data || [],
        total: r.total || 0,
      }));
    },
  });
  const products = table.rows;
  const { total, page, perPage, sortBy, sortDir, paginationMode } = table;

  const refreshAfterMutation = () => {
    window.dispatchEvent(new CustomEvent('voicex:alerts-count-refresh'));
    table.refresh();
  };
  useEffect(() => {
    apiGet<any>('/catalog/categories').then((r) => setCategories(r.data || []));
    apiGet<any>('/settings').then((r) => {
      const row = (r.data || []).find((s: { key: string }) => s.key === 'default_markup_percent');
      if (row?.value != null && row.value !== '') {
        const n = parseFloat(String(row.value));
        if (!Number.isNaN(n)) setDefaultMarkupPercent(n);
      }
    });
  }, []);

  const handleLookup = async () => {
    const trimmed = asinInput.trim().toUpperCase();
    if (!trimmed) return;
    setLookupLoading(true);
    setLookupError('');
    setLookupData(null);
    try {
      const r = await apiPost<any>('/catalog/products/lookup-asin', { asin: trimmed });
      setLookupData(r.data);
      setAsinInput(trimmed);
    } catch (err: any) {
      setLookupError(err.message || 'Failed to look up product.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!lookupData) return;
    setSaving(true);
    try {
      await apiPost('/catalog/products', {
        amazon_asin: lookupData.asin,
        amazon_url: lookupData.url,
        amazon_name: lookupData.name,
        amazon_description: lookupData.description,
        amazon_price_cents: lookupData.price_cents,
        amazon_image_urls: lookupData.images || [],
        voice_name: createOverrides.voice_name || null,
        voice_description: createOverrides.voice_description || null,
        custom_price_cents: createOverrides.custom_price_cents
          ? parseInt(createOverrides.custom_price_cents, 10)
          : null,
        local_price_cents: createOverrides.local_price_cents
          ? parseInt(createOverrides.local_price_cents, 10)
          : null,
        category_ids: createOverrides.category_ids,
      });
      setShowForm(false);
      resetCreateForm();
      refreshAfterMutation();
    } catch (err: any) {
      setLookupError(err.message || 'Failed to create product.');
    } finally {
      setSaving(false);
    }
  };

  const resetBulkCreate = () => {
    setBulkAsinChips([]);
    setBulkPasteBuffer('');
    setBulkPhase('input');
    setBulkRows([]);
    setBulkLookupRunning(false);
    setBulkInputError('');
  };

  /** Clears single-ASIN add flow only; does not touch bulk draft state or mode. */
  const resetSingleCreateFields = () => {
    setAsinInput('');
    setLookupData(null);
    setLookupError('');
    setCreateOverrides(emptyCreateOverrides());
  };

  const resetCreateForm = () => {
    resetSingleCreateFields();
    resetBulkCreate();
    setAddProductMode('single');
  };

  const switchToBulkMode = () => {
    setAddProductMode('bulk');
    resetSingleCreateFields();
    resetBulkCreate();
  };

  const switchToSingleAsinMode = () => {
    setAddProductMode('single');
    resetBulkCreate();
  };

  const effectiveBulkAsinList = dedupeOrderedAppend(bulkAsinChips, parseAsinsFromText(bulkPasteBuffer));

  const mergeBulkPasteBufferIntoChips = () => {
    setBulkAsinChips((prev) => dedupeOrderedAppend(prev, parseAsinsFromText(bulkPasteBuffer)));
    setBulkPasteBuffer('');
  };

  const removeBulkRowById = (rowId: string) => {
    setBulkRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  useEffect(() => {
    if (addProductMode !== 'bulk' || bulkPhase !== 'results') return;
    if (bulkRows.length === 0) {
      setBulkPhase('input');
      setBulkAsinChips([]);
    }
  }, [addProductMode, bulkPhase, bulkRows.length]);

  const handleBulkLookup = async () => {
    setBulkInputError('');
    const asins = dedupeOrderedAppend(bulkAsinChips, parseAsinsFromText(bulkPasteBuffer));
    if (asins.length === 0) {
      setBulkInputError('Enter at least one valid 10-character Amazon ASIN.');
      return;
    }
    setBulkLookupRunning(true);
    setBulkPasteBuffer('');
    setBulkAsinChips(asins);
    const initialRows: BulkProductRow[] = asins.map((asin) => ({
      id: crypto.randomUUID(),
      asin,
      lookupData: null,
      lookupError: '',
      lookupLoading: true,
      overrides: emptyCreateOverrides(),
      saving: false,
    }));
    setBulkRows(initialRows);
    setBulkPhase('results');

    await mapWithConcurrency(initialRows, BULK_LOOKUP_CONCURRENCY, async (row) => {
      try {
        const r = await apiPost<any>('/catalog/products/lookup-asin', { asin: row.asin });
        setBulkRows((prev) =>
          prev.map((x) =>
            x.id === row.id ? { ...x, lookupLoading: false, lookupData: r.data, lookupError: '' } : x,
          ),
        );
      } catch (err: any) {
        const msg = err.message || 'Failed to look up product.';
        setBulkRows((prev) =>
          prev.map((x) =>
            x.id === row.id ? { ...x, lookupLoading: false, lookupData: null, lookupError: msg } : x,
          ),
        );
      }
    });
    setBulkLookupRunning(false);
  };

  const handleBulkRowCreate = async (row: BulkProductRow) => {
    if (!row.lookupData) return;
    setBulkRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, saving: true, lookupError: '' } : r)));
    try {
      await apiPost('/catalog/products', {
        amazon_asin: row.lookupData.asin,
        amazon_url: row.lookupData.url,
        amazon_name: row.lookupData.name,
        amazon_description: row.lookupData.description,
        amazon_price_cents: row.lookupData.price_cents,
        amazon_image_urls: row.lookupData.images || [],
        voice_name: row.overrides.voice_name || null,
        voice_description: row.overrides.voice_description || null,
        custom_price_cents: row.overrides.custom_price_cents
          ? parseInt(row.overrides.custom_price_cents, 10)
          : null,
        local_price_cents: row.overrides.local_price_cents
          ? parseInt(row.overrides.local_price_cents, 10)
          : null,
        category_ids: row.overrides.category_ids,
      });
      removeBulkRowById(row.id);
      refreshAfterMutation();
    } catch (err: any) {
      setBulkRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, saving: false, lookupError: err.message || 'Failed to create product.' } : r,
        ),
      );
    }
  };

  const updateBulkRowOverrides = (rowId: string, next: CreateProductOverrides) => {
    setBulkRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, overrides: next } : r)));
  };

  const cancelView = () => {
    setViewingId(null);
    setViewProduct(null);
    setViewLoading(false);
    setViewError(null);
  };

  const startView = (product: any) => {
    if (viewingId === product.id && !viewError) {
      cancelView();
      return;
    }
    cancelEdit();
    setViewingId(product.id);
    setViewProduct(null);
    setViewError(null);
    setViewLoading(true);
    apiGet<any>(`/catalog/products/${product.id}`)
      .then((r) => {
        if (!r.data) throw new Error('Product not found.');
        setViewProduct(r.data);
      })
      .catch((err: unknown) => {
        setViewProduct(null);
        setViewError(err instanceof Error ? err.message : 'Failed to load product details.');
      })
      .finally(() => setViewLoading(false));
  };

  const startEdit = (product: any) => {
    cancelView();
    setEditingId(product.id);
    setEditForm(buildEditForm(product));
    setShowForm(false);
    resetSingleCreateFields();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const closeCategoryPopup = () => {
    setCategoryPopupProductId(null);
    setCategoryEditDraft([]);
    setCategoryAnchorEl(null);
    setCategorySaveError(null);
  };

  const closeStatusPopup = () => {
    setStatusPopupProductId(null);
    setStatusAnchorEl(null);
    setStatusSaveError(null);
  };

  const toggleCategoryPopup = (product: any, anchor: HTMLElement) => {
    if (categoryPopupProductId === product.id) {
      closeCategoryPopup();
      return;
    }
    closeStatusPopup();
    setCategorySaveError(null);
    setCategoryAnchorEl(anchor);
    setCategoryPopupProductId(product.id);
    setCategoryEditDraft(product.catalog_product_categories?.map((c: any) => c.category_id) || []);
  };

  const toggleStatusPopup = (product: any, anchor: HTMLElement) => {
    if (statusPopupProductId === product.id) {
      closeStatusPopup();
      return;
    }
    closeCategoryPopup();
    setStatusSaveError(null);
    setStatusAnchorEl(anchor);
    setStatusPopupProductId(product.id);
    setStatusEditDraft(isCatalogProductStatus(product.status) ? product.status : 'inactive');
  };

  const handleStatusSave = async () => {
    if (!statusPopupProductId) return;
    setStatusSaving(true);
    setStatusSaveError(null);
    try {
      const savedId = statusPopupProductId;
      const savedStatus = statusEditDraft;
      const resp = await apiPatch<any>(`/catalog/products/${savedId}`, { status: savedStatus });
      const updated = resp?.data;
      table.setRows((prev) =>
        prev.map((row) =>
          row.id === savedId ? { ...row, ...(updated || {}), status: savedStatus } : row,
        ),
      );
      if (editingId === savedId) {
        setEditForm((prev: any) => ({ ...prev, status: savedStatus }));
      }
      if (viewProduct?.id === savedId) {
        setViewProduct((prev: any) => (prev ? { ...prev, status: savedStatus } : prev));
      }
      closeStatusPopup();
    } catch (err: unknown) {
      setStatusSaveError(err instanceof Error ? err.message : 'Failed to save status.');
    } finally {
      setStatusSaving(false);
    }
  };

  const handleCategorySave = async () => {
    if (!categoryPopupProductId) return;
    setCategorySaving(true);
    setCategorySaveError(null);
    try {
      const savedId = categoryPopupProductId;
      const savedDraft = [...categoryEditDraft];
      await apiPatch<any>(`/catalog/products/${savedId}`, { category_ids: savedDraft });
      const nextCategoryLinks = buildCategoryLinks(savedDraft, categories);
      table.setRows((prev) =>
        prev.map((row) =>
          row.id === savedId ? { ...row, catalog_product_categories: nextCategoryLinks } : row,
        ),
      );
      if (editingId === savedId) {
        setEditForm((prev: any) => ({ ...prev, category_ids: savedDraft }));
      }
      closeCategoryPopup();
    } catch (err: unknown) {
      setCategorySaveError(err instanceof Error ? err.message : 'Failed to save categories.');
    } finally {
      setCategorySaving(false);
    }
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const savedId = editingId;
      const currentForm = { ...editForm };
      const resp = await apiPatch<any>(`/catalog/products/${savedId}`, {
        ...currentForm,
        amazon_price_cents: currentForm.amazon_price_cents !== '' ? parseInt(currentForm.amazon_price_cents) : null,
        custom_price_cents:
          currentForm.custom_price_cents !== '' ? parseInt(currentForm.custom_price_cents, 10) : null,
        local_price_cents:
          currentForm.local_price_cents !== '' && currentForm.local_price_cents != null
            ? parseInt(String(currentForm.local_price_cents), 10)
            : null,
      });
      setEditingId(null);
      setEditForm({});
      // Update the edited row in place instead of refetching the whole list, so
      // the user keeps their exact scroll/pagination position and filters.
      const updated = resp?.data;
      if (updated) {
        // The PATCH response doesn't include the joined categories relation, so
        // rebuild it from the form so a subsequent edit shows the right values.
        const nextCategoryLinks = buildCategoryLinks(currentForm.category_ids || [], categories);
        table.setRows((prev) =>
          prev.map((row) =>
            row.id === savedId
              ? { ...row, ...updated, catalog_product_categories: nextCategoryLinks }
              : row,
          ),
        );
      }
      window.dispatchEvent(new CustomEvent('voicex:alerts-count-refresh'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiDelete(`/catalog/products/${deleteConfirm.id}`);
      if (editingId === deleteConfirm.id) cancelEdit();
      if (viewingId === deleteConfirm.id) cancelView();
      table.setRows((prev) => prev.filter((p) => p.id !== deleteConfirm.id));
      table.setTotal((prev) => prev - 1);
      setDeleteConfirm(null);
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete product');
    } finally {
      setDeleting(false);
    }
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirm(null);
    setDeleteError(null);
  };

  const handleExportPdf = async () => {
    const capSearch = search;
    const capFilterIds = [...filterCategoryIds];
    const capFilterStatus = filterStatus;
    const capSortBy = sortBy;
    const capSortDir = sortDir;
    const capTotal = total;

    if (capTotal === 0) {
      window.alert('No products to export.');
      return;
    }

    setPdfExporting(true);
    try {
      const all: CatalogProduct[] = [];
      let exportPage = 1;
      for (;;) {
        if (all.length >= capTotal) break;
        const params = new URLSearchParams({
          page: String(exportPage),
          per_page: String(PDF_EXPORT_PER_PAGE),
          sort_by: capSortBy,
          sort_dir: capSortDir,
        });
        if (capSearch) params.set('search', capSearch);
        if (capFilterIds.length > 0) params.set('category_ids', capFilterIds.join(','));
        if (capFilterStatus !== 'all') params.set('status', capFilterStatus);
        const r = await apiGet<{ data?: CatalogProduct[] }>(`/catalog/products?${params}`);
        const chunk = r.data || [];
        if (chunk.length === 0) break;
        all.push(...chunk);
        if (chunk.length < PDF_EXPORT_PER_PAGE) break;
        exportPage += 1;
        if (exportPage > 500) break;
      }

      const subtitleLines: string[] = [`${all.length} product(s) · ${new Date().toLocaleString()}`];
      if (capSearch.trim()) subtitleLines.push(`Search: ${capSearch}`);
      if (capFilterIds.length > 0) {
        const names = capFilterIds
          .map((id) => categories.find((c) => c.id === id)?.name)
          .filter((n): n is string => Boolean(n));
        subtitleLines.push(names.length > 0 ? `Categories: ${names.join(', ')}` : `Category IDs: ${capFilterIds.join(', ')}`);
      }
      if (capFilterStatus === 'active') subtitleLines.push('Status: Active');
      else if (capFilterStatus === 'inactive') subtitleLines.push('Status: Inactive');
      else if (capFilterStatus === 'frozen') subtitleLines.push('Status: Frozen');

      const blob = await buildProductsListPdfBlob(all, defaultMarkupPercent, { subtitleLines });
      const url = URL.createObjectURL(blob);
      // With `noopener`, many browsers return `null` even when a tab opened successfully.
      // Do not treat a null return as failure or revoke the URL in that case.
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to export PDF.';
      window.alert(msg);
    } finally {
      setPdfExporting(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Products</h2>
        <div className="flex items-center gap-2">
          {isSuper && (
            <Link
              to="/admin/products/deleted"
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Trash size={16} /> Deleted Products
            </Link>
          )}
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={pdfExporting}
            title="Export list to PDF"
            aria-label="Export list to PDF"
            className="flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {pdfExporting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Printer size={18} aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => {
              cancelEdit();
              if (showForm) {
                setShowForm(false);
                resetCreateForm();
              } else {
                resetCreateForm();
                setShowForm(true);
              }
            }}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
          >
            <Plus size={16} /> Add Product
          </button>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-800 hover:bg-indigo-100"
          >
            <Upload size={16} /> Import
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          {addProductMode === 'single' ? (
            <>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="flex-1 max-w-xs">
                  <label className="text-sm font-medium text-gray-600">Amazon ASIN</label>
                  <input
                    value={asinInput}
                    onChange={(e) => setAsinInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleLookup();
                      }
                    }}
                    placeholder="e.g. B09V3KXJPB"
                    maxLength={10}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm font-mono tracking-wider"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleLookup()}
                  disabled={lookupLoading || !asinInput.trim()}
                  className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {lookupLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Looking up...
                    </>
                  ) : (
                    'Lookup'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    resetCreateForm();
                  }}
                  className="rounded border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={switchToBulkMode}
                  className="rounded border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-800 hover:bg-indigo-100"
                >
                  Add Bulk
                </button>
              </div>

              {lookupError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {lookupError}
                </div>
              )}

              {lookupData && (
                <CreateFromLookupPanel
                  lookupData={lookupData}
                  overrides={createOverrides}
                  onOverridesChange={setCreateOverrides}
                  categories={categories}
                  defaultMarkupPercent={defaultMarkupPercent}
                  onQuickCategoryNew={() => setQuickCategoryTarget('create')}
                  onCreate={() => void handleCreate()}
                  onRowCancel={() => {
                    setShowForm(false);
                    resetCreateForm();
                  }}
                  saving={saving}
                />
              )}
            </>
          ) : (
            <>
              {bulkPhase === 'input' && (
                <>
                  <div className="mb-4 flex flex-wrap items-end gap-3">
                    <div className="min-w-0 flex-1 max-w-2xl">
                      <label className="text-sm font-medium text-gray-600">Add Multiple Amazon ASINs</label>
                      <textarea
                        value={bulkPasteBuffer}
                        onChange={(e) => setBulkPasteBuffer(e.target.value)}
                        onBlur={mergeBulkPasteBufferIntoChips}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            mergeBulkPasteBufferIntoChips();
                          }
                        }}
                        placeholder="Paste ASINs — commas, spaces, tabs, colons, new lines, etc."
                        rows={4}
                        className="mt-1 w-full rounded border px-3 py-2 text-sm font-mono tracking-wider"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Press Enter (without Shift) or blur the field to add parsed ASINs to the list below.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={switchToSingleAsinMode}
                      className="rounded border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-800 hover:bg-indigo-100"
                    >
                      Add Single ASIN
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBulkLookup()}
                      disabled={bulkLookupRunning || effectiveBulkAsinList.length === 0}
                      className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {bulkLookupRunning ? (
                        <>
                          <Loader2 size={14} className="animate-spin" /> Looking up...
                        </>
                      ) : (
                        'Lookup'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        resetCreateForm();
                      }}
                      className="rounded border px-4 py-2 text-sm"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="mb-4 flex flex-col gap-2">
                    {bulkAsinChips.map((asin) => (
                      <div
                        key={asin}
                        className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                      >
                        <span className="font-mono text-sm tracking-wider text-gray-800">{asin}</span>
                        <button
                          type="button"
                          title={`Remove ${asin}`}
                          aria-label={`Remove ${asin}`}
                          onClick={() => setBulkAsinChips((prev) => prev.filter((a) => a !== asin))}
                          className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {bulkInputError && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {bulkInputError}
                    </div>
                  )}
                </>
              )}

              {bulkPhase === 'results' && (
                <div className="mb-4 flex flex-wrap items-end gap-3">
                  <button
                    type="button"
                    onClick={switchToSingleAsinMode}
                    className="rounded border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-800 hover:bg-indigo-100"
                  >
                    Add Single ASIN
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      resetCreateForm();
                    }}
                    className="rounded border px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {bulkPhase === 'results' && (
                <div className="space-y-6">
                  {bulkRows.map((row) => (
                    <div key={row.id} className="rounded-xl border border-gray-200 p-4 shadow-sm">
                      <h3 className="mb-3 text-base font-semibold text-gray-900">
                        Amazon ASIN:{' '}
                        <span className="font-mono tracking-wide text-indigo-700">{row.asin}</span>
                      </h3>
                      {row.lookupLoading && (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-600">
                          <Loader2 size={18} className="animate-spin" aria-hidden />
                          Looking up…
                        </div>
                      )}
                      {!row.lookupLoading && row.lookupError && !row.lookupData && (
                        <div>
                          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {row.lookupError}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeBulkRowById(row.id)}
                            className="rounded border px-4 py-2 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {!row.lookupLoading && row.lookupData && (
                        <>
                          {row.lookupError ? (
                            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                              {row.lookupError}
                            </div>
                          ) : null}
                          <CreateFromLookupPanel
                            lookupData={row.lookupData}
                            overrides={row.overrides}
                            onOverridesChange={(next) => updateBulkRowOverrides(row.id, next)}
                            categories={categories}
                            defaultMarkupPercent={defaultMarkupPercent}
                            onQuickCategoryNew={() => setQuickCategoryTarget({ type: 'bulk', rowId: row.id })}
                            onCreate={() => {
                              const latest = bulkRows.find((r) => r.id === row.id);
                              if (latest) void handleBulkRowCreate(latest);
                            }}
                            onRowCancel={() => removeBulkRowById(row.id)}
                            saving={row.saving}
                          />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={(e) => { e.preventDefault(); table.setPage(1); }} className="min-w-[16rem] shrink-0">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, ASIN, ID, or price..."
              className="w-full rounded-lg border py-2 pl-9 pr-10 text-sm"
            />
            <button
              type={search.trim() ? 'button' : 'submit'}
              title={search.trim() ? 'Clear search' : 'Search'}
              aria-label={search.trim() ? 'Clear search' : 'Search'}
              onClick={
                search.trim()
                  ? () => {
                      setSearch('');
                      table.setPage(1);
                    }
                  : undefined
              }
              className={`absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md p-1 ${
                search.trim()
                  ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {search.trim() ? <X size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
            </button>
          </div>
        </form>
        <SearchableMultiSelect
          className="w-[13.5rem] shrink-0"
          leadingIcon={<Tags size={16} className="shrink-0 text-gray-400" aria-hidden />}
          triggerClassName="mt-0"
          options={[
            { value: '__all__', label: 'All categories' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
          value={filterCategoryIds.length === 0 ? ['__all__'] : filterCategoryIds}
          onChange={(ids) => {
            const wasAll = filterCategoryIds.length === 0;
            const picked = ids.filter((id) => id !== '__all__');
            const justSelectedAll = ids.includes('__all__') && !wasAll;
            setFilterCategoryIds(justSelectedAll ? [] : picked);
            table.setPage(1);
          }}
          placeholder="All categories"
        />
        <FilterSingleSelect
          className="w-[8.25rem] shrink-0"
          leadingIcon={<ToggleLeft size={16} className="shrink-0 text-gray-400" aria-hidden />}
          aria-label="Filter by status"
          value={filterStatus}
          onChange={(v) => {
            setFilterStatus(v as ProductStatusFilter);
            table.setPage(1);
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'frozen', label: 'Frozen' },
          ]}
        />
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className={`${PRODUCTS_TABLE_HEADER} w-16`}>Image</th>
              <SortHeader label="VoiceX ID" field="voicex_id" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName={PRODUCTS_TABLE_HEADER} />
              <SortHeader label="Name" field="name_sort_key" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName={PRODUCTS_TABLE_HEADER} />
              <SortHeader label="ASIN" field="amazon_asin" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName={PRODUCTS_TABLE_HEADER} />
              <SortHeader label="Amazon Price" field="amazon_price_cents" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName={PRODUCTS_TABLE_HEADER} />
              <SortHeader label="Custom Price" field="custom_price_cents" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName={PRODUCTS_TABLE_HEADER} />
              <SortHeader label="Local Price" field="local_price_cents" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName={PRODUCTS_TABLE_HEADER} />
              <SortHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName={PRODUCTS_TABLE_HEADER} />
              <SortHeader label="Lifetime Sold" field="lifetime_qty_sold" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName={PRODUCTS_TABLE_HEADER} />
              <SortHeader label="Category" field="category_name" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName={PRODUCTS_TABLE_HEADER} />
              <th className={`${PRODUCTS_TABLE_HEADER} w-24`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <Fragment key={p.id}>
                <tr className={`border-b hover:bg-gray-50 ${editingId === p.id || viewingId === p.id ? 'bg-indigo-50' : ''}`}>
                  <td className={PRODUCTS_TABLE_CELL}>
                    <ProductThumbnail
                      thumbnailUrl={p.thumbnail_url}
                      images={p.amazon_image_urls}
                      alt={p.voice_name || p.amazon_name || p.voicex_id}
                      size={48}
                    />
                  </td>
                  <td className={`${PRODUCTS_TABLE_CELL} font-mono`}>{p.voicex_id}</td>
                  <td className={PRODUCTS_TABLE_CELL}>
                    <button
                      type="button"
                      onClick={() => startView(p)}
                      className="text-left text-indigo-600 hover:underline"
                    >
                      {p.voice_name || p.amazon_name || '-'}
                    </button>
                  </td>
                  <td className={`${PRODUCTS_TABLE_CELL} text-gray-500`}>{p.amazon_asin}</td>
                  <td className={PRODUCTS_TABLE_CELL}>{p.amazon_price_cents ? `$${(p.amazon_price_cents / 100).toFixed(2)}` : '-'}</td>
                  <td className={PRODUCTS_TABLE_CELL}>
                    <CustomPriceReadonlyDisplay product={p} defaultMarkupPercent={defaultMarkupPercent} />
                  </td>
                  <td
                    className={`${PRODUCTS_TABLE_CELL} tabular-nums ${
                      isProductVoicexPriceAboveLocal(p, defaultMarkupPercent)
                        ? 'font-bold text-red-600'
                        : 'text-gray-600'
                    }`}
                  >
                    {p.local_price_cents != null ? `$${(p.local_price_cents / 100).toFixed(2)}` : '—'}
                  </td>
                  <td className={PRODUCTS_TABLE_CELL}>
                    <button
                      type="button"
                      onClick={(e) => toggleStatusPopup(p, e.currentTarget)}
                      className={`rounded-full px-2 py-0.5 text-xs hover:ring-2 hover:ring-indigo-200 ${
                        catalogProductStatusBadgeClass(isCatalogProductStatus(p.status) ? p.status : 'inactive')
                      } ${statusPopupProductId === p.id ? 'ring-2 ring-indigo-400' : ''}`}
                      title="Edit status"
                    >
                      {catalogProductStatusLabel(isCatalogProductStatus(p.status) ? p.status : 'inactive')}
                    </button>
                  </td>
                  <td className={`${PRODUCTS_TABLE_CELL} text-gray-600`}>{p.lifetime_qty_sold}</td>
                  <td className={`${PRODUCTS_TABLE_CELL} text-gray-600`}>
                    <button
                      type="button"
                      onClick={(e) => toggleCategoryPopup(p, e.currentTarget)}
                      className={`max-w-[12rem] text-left leading-snug hover:text-indigo-600 ${
                        categoryPopupProductId === p.id ? 'text-indigo-600' : ''
                      }`}
                      title="Edit categories"
                    >
                      <ProductCategoryLabels product={p} />
                    </button>
                  </td>
                  <td className={PRODUCTS_TABLE_CELL}>
                    <div className="flex items-center gap-1">
                      {p.amazon_url && (
                        <a href={p.amazon_url} target="_blank" rel="noopener noreferrer" title="View on Amazon"
                          className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600">
                          <ExternalLink size={16} />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => startView(p)}
                        title="View product details"
                        className={`rounded p-1 ${
                          viewingId === p.id
                            ? 'bg-indigo-50 text-indigo-600'
                            : 'text-gray-400 hover:bg-indigo-50 hover:text-indigo-600'
                        }`}
                      >
                        <Eye size={16} />
                      </button>
                      {viewingId === p.id ? (
                        <button onClick={cancelView} title="Close details"
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                          <X size={16} />
                        </button>
                      ) : editingId === p.id ? (
                        <button onClick={cancelEdit} title="Cancel edit"
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                          <X size={16} />
                        </button>
                      ) : (
                        <button onClick={() => startEdit(p)} title="Edit product"
                          className="rounded p-1 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600">
                          <Pencil size={16} />
                        </button>
                      )}
                      <button onClick={() => setDeleteConfirm({ id: p.id, name: p.voice_name || p.amazon_name || p.voicex_id })} title="Delete product"
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
                {viewingId === p.id && (
                  <tr className="border-b bg-indigo-50/50">
                    <td colSpan={11} className="px-6 py-4">
                      <div className="rounded-lg border border-indigo-200 bg-white p-5">
                        <div className="mb-4 flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-gray-700">Product Details</h4>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => viewProduct && startEdit(viewProduct)}
                              disabled={!viewProduct || viewLoading}
                              title="Edit product"
                              className="rounded p-1 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteConfirm({ id: p.id, name: p.voice_name || p.amazon_name || p.voicex_id })
                              }
                              title="Delete product"
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={cancelView}
                              title="Close details"
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                        {viewLoading ? (
                          <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
                            <Loader2 size={18} className="animate-spin" aria-hidden />
                            Loading product details…
                          </div>
                        ) : viewError ? (
                          <div className="py-4">
                            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                              {viewError}
                            </div>
                            <button
                              type="button"
                              onClick={() => startView(p)}
                              className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
                            >
                              Retry
                            </button>
                          </div>
                        ) : viewProduct ? (
                          <ProductDetailView product={viewProduct} defaultMarkupPercent={defaultMarkupPercent} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )}
                {editingId === p.id && (
                  <tr className="border-b bg-indigo-50/50">
                    <td colSpan={11} className="px-6 py-4">
                      <div className="rounded-lg border border-indigo-200 bg-white p-5">
                        <h4 className="mb-4 text-sm font-semibold text-gray-700">Edit Product</h4>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <label className="text-sm font-medium text-gray-600">VoiceX ID</label>
                            <input value={editForm.voicex_id} onChange={(e) => { const v = e.target.value; setEditForm((prev: any) => ({ ...prev, voicex_id: v })); }}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon ASIN</label>
                            <input value={editForm.amazon_asin} readOnly
                              className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon URL</label>
                            <input value={editForm.amazon_url} readOnly
                              className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon Name</label>
                            <input value={editForm.amazon_name} readOnly
                              className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon Description</label>
                            <input value={editForm.amazon_description} readOnly
                              className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Amazon Price (cents)</label>
                            <input type="number" value={editForm.amazon_price_cents} readOnly
                              className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">VoiceX Name (override)</label>
                            <input value={editForm.voice_name} onChange={(e) => { const v = e.target.value; setEditForm((prev: any) => ({ ...prev, voice_name: v })); }}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">VoiceX Description (override)</label>
                            <input value={editForm.voice_description} onChange={(e) => { const v = e.target.value; setEditForm((prev: any) => ({ ...prev, voice_description: v })); }}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Custom Price (cents)</label>
                            <input
                              type="number"
                              value={editForm.custom_price_cents}
                              onChange={(e) => { const v = e.target.value; setEditForm((prev: any) => ({ ...prev, custom_price_cents: v })); }}
                              onWheel={(e) => (e.target as HTMLInputElement).blur()}
                              placeholder={customPriceInputPlaceholder(p.amazon_price_cents, defaultMarkupPercent)}
                              className="mt-1 w-full rounded border px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-600">Local Store Price (cents)</label>
                            <input
                              type="number"
                              value={editForm.local_price_cents}
                              onChange={(e) => { const v = e.target.value; setEditForm((prev: any) => ({ ...prev, local_price_cents: v })); }}
                              onWheel={(e) => (e.target as HTMLInputElement).blur()}
                              placeholder="Optional — for savings at checkout"
                              className="mt-1 w-full rounded border px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-sm font-medium text-gray-600">Status</span>
                            <div className="mt-2">
                              <ProductStatusRadioGroup
                                name={`product-status-edit-${p.id}`}
                                value={isCatalogProductStatus(editForm.status) ? editForm.status : 'inactive'}
                                onChange={(status) => setEditForm((prev: any) => ({ ...prev, status }))}
                              />
                            </div>
                          </div>
                          <div className="sm:col-span-2 lg:col-span-3">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-medium text-gray-600">Categories</label>
                              <button
                                type="button"
                                onClick={() => setQuickCategoryTarget('edit')}
                                className="flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
                                title="Create new category"
                              >
                                <Plus size={12} /> New
                              </button>
                            </div>
                            <SearchableMultiSelect
                              options={categories.map((c) => ({ value: c.id, label: c.name }))}
                              value={editForm.category_ids || []}
                              onChange={(ids) => setEditForm((prev: any) => ({ ...prev, category_ids: ids }))}
                              placeholder="Select categories..."
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex gap-2">
                          <button onClick={handleEditSave} disabled={saving}
                            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button onClick={cancelEdit} className="rounded border px-4 py-2 text-sm">Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        <EndlessTail
          paginationMode={paginationMode}
          hasMore={table.hasMoreEndless}
          isLoadingMore={table.isLoadingMore}
          total={total}
          sentinelRef={table.sentinelRef}
          itemLabel="product"
        />

        <PaginationFooter
          page={page}
          perPage={perPage}
          total={total}
          loadedCount={products.length}
          paginationMode={paginationMode}
          onPageChange={table.setPage}
          onPerPageChange={table.setPerPage}
          onPaginationModeChange={table.switchPaginationMode}
          itemLabel="Product"
          itemLabelPlural="Products"
          pageSizeOptions={PRODUCT_PAGE_SIZE_OPTIONS}
        />
      </div>

      <ImportProductsFlow
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={refreshAfterMutation}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />

      <CategoryInlineEditor
        open={categoryPopupProductId !== null}
        anchorEl={categoryAnchorEl}
        categories={categories}
        draftIds={categoryEditDraft}
        saving={categorySaving}
        saveError={categorySaveError}
        onDraftChange={setCategoryEditDraft}
        onSave={handleCategorySave}
        onCancel={closeCategoryPopup}
        onQuickCategoryNew={() => setQuickCategoryTarget({ type: 'inline' })}
      />

      <StatusInlineEditor
        open={statusPopupProductId !== null}
        anchorEl={statusAnchorEl}
        draftStatus={statusEditDraft}
        saving={statusSaving}
        saveError={statusSaveError}
        onDraftChange={setStatusEditDraft}
        onSave={handleStatusSave}
        onCancel={closeStatusPopup}
      />

      <CategoryQuickCreateModal
        open={quickCategoryTarget !== null}
        onClose={() => setQuickCategoryTarget(null)}
        categories={categories}
        onCreated={(newCat) => {
          setCategories((prev) => [...prev, newCat]);
          const target = quickCategoryTarget;
          if (target === 'create') {
            setCreateOverrides((prev) => ({
              ...prev,
              category_ids: [...prev.category_ids, newCat.id],
            }));
          } else if (target === 'edit') {
            setEditForm((prev: any) => ({
              ...prev,
              category_ids: [...(prev.category_ids || []), newCat.id],
            }));
          } else if (target && typeof target === 'object' && target.type === 'inline') {
            setCategoryEditDraft((prev) =>
              prev.includes(newCat.id) ? prev : [...prev, newCat.id],
            );
          } else if (target && typeof target === 'object' && target.type === 'bulk') {
            const rid = target.rowId;
            setBulkRows((prev) =>
              prev.map((r) =>
                r.id === rid ? { ...r, overrides: { ...r.overrides, category_ids: [...r.overrides.category_ids, newCat.id] } } : r,
              ),
            );
          }
        }}
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete Product</h3>
            </div>
            <p className="mb-6 text-sm text-gray-600">
              {isSuper ? (
                <>This will <span className="font-medium text-red-700">permanently delete</span> <span className="font-medium text-gray-900">"{deleteConfirm.name}"</span>. This action cannot be undone.</>
              ) : (
                <>Are you sure you want to delete <span className="font-medium text-gray-900">"{deleteConfirm.name}"</span>? This action cannot be undone.</>
              )}
            </p>
            {deleteError && (
              <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {deleteError}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={closeDeleteConfirm}
                disabled={deleting}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
