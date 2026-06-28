import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Trash2, AlertTriangle, Plus } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import { formatUsdFromCents } from '../lib/product-price';
import { ProductThumbnail } from '../components/ProductThumbnail';
import {
  ADMIN_ALERT_TYPES,
  adminAlertTypeLabel,
  amazonAvailabilityStatusLabel,
  getProductDisplayName,
  SUBSCRIPTION_ALERT_TYPES,
  subscriptionAlertIssueLabel,
  type CatalogProduct,
} from '@voicex/shared';
import { CatalogProductStatusBadge } from '../components/CatalogProductStatusBadge';
import { EndlessTail, PaginationFooter, SortHeader, useAdminTableQuery, useRowSelection, SelectAllCheckbox, RowCheckbox, BulkActionBar, type BulkAction } from '../components/admin-table';

type AlertStatus = 'new' | 'reviewing' | 'resolved';

const ALERT_STATUS_OPTIONS: AlertStatus[] = ['new', 'reviewing', 'resolved'];

type EmbeddedProduct = CatalogProduct & {
  thumbnail_url?: string | null;
};

interface AdminAlertRow {
  id: string;
  alert_type: string;
  status: AlertStatus;
  title: string;
  message: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  catalog_products: EmbeddedProduct | null;
  effective_custom_price_cents: number | null;
}

interface ListResponse {
  success: boolean;
  data: AdminAlertRow[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

function statusBadgeClass(status: AlertStatus) {
  switch (status) {
    case 'new':
      return 'bg-red-100 text-red-800';
    case 'reviewing':
      return 'bg-amber-100 text-amber-800';
    case 'resolved':
      return 'bg-green-100 text-green-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function statusLabel(status: AlertStatus) {
  switch (status) {
    case 'new':
      return 'New';
    case 'reviewing':
      return 'Reviewing';
    case 'resolved':
      return 'Resolved';
    default:
      return status;
  }
}

function emitAlertsCountRefresh() {
  window.dispatchEvent(new CustomEvent('voicex:alerts-count-refresh'));
}

function AlertStatusRadioGroup({
  name,
  value,
  onChange,
}: {
  name: string;
  value: AlertStatus;
  onChange: (status: AlertStatus) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {ALERT_STATUS_OPTIONS.map((status) => (
        <label key={status} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            checked={value === status}
            onChange={() => onChange(status)}
          />
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(status)}`}>
            {statusLabel(status)}
          </span>
        </label>
      ))}
    </div>
  );
}

function AlertStatusInlineEditor({
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
  draftStatus: AlertStatus;
  saving: boolean;
  onDraftChange: (status: AlertStatus) => void;
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
      aria-label="Edit alert status"
    >
      <span className="mb-3 block text-sm font-medium text-gray-700">Alert status</span>
      <AlertStatusRadioGroup
        name="alert-status-inline"
        value={draftStatus}
        onChange={onDraftChange}
      />
      {saveError ? <p className="mt-2 text-sm text-red-600">{saveError}</p> : null}
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

type AlertTypeTab = string;

/** Single UI tab for all catalog product alert types (price, availability, etc.). */
const PRODUCT_ALERTS_TAB_ID = '__product_catalog__';

const ALERT_TYPE_TABS: AlertTypeTab[] = [
  PRODUCT_ALERTS_TAB_ID,
  ADMIN_ALERT_TYPES.HIGH_RETURNING_USER,
  ...SUBSCRIPTION_ALERT_TYPES,
];

function isProductCatalogAlertTab(tab: AlertTypeTab): boolean {
  return tab === PRODUCT_ALERTS_TAB_ID;
}

function alertTabLabel(tab: AlertTypeTab): string {
  if (isProductCatalogAlertTab(tab)) return 'Product Alerts';
  return adminAlertTypeLabel(tab);
}

function isUserAlertTab(tab: AlertTypeTab): boolean {
  return tab === ADMIN_ALERT_TYPES.HIGH_RETURNING_USER;
}

function isSubscriptionAlertTab(tab: AlertTypeTab): boolean {
  return (SUBSCRIPTION_ALERT_TYPES as readonly string[]).includes(tab);
}

/** Inline user picker (searchable) for the manual-alert modal + user filter. */
function UserPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (u: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  const search = async (term: string) => {
    if (!term.trim()) { setResults([]); return; }
    const params = new URLSearchParams({ search: term.trim(), per_page: '8' });
    const r = await apiGet<any>(`/users?${params}`);
    setResults(r.data || []);
    setOpen(true);
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">{value.name}</span>
        <button type="button" className="text-xs text-gray-400 hover:underline" onClick={() => onChange(null)}>change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        className="w-full rounded border px-3 py-2 text-sm"
        placeholder="Search user by name"
        value={q}
        onChange={(e) => { setQ(e.target.value); void search(e.target.value); }}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border bg-white text-sm shadow">
          {results.map((u) => (
            <li key={u.id}>
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => { onChange({ id: u.id, name: u.name }); setOpen(false); }}>
                {u.name} <span className="text-gray-400">{u.email || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddAlertModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null);
  const [week, setWeek] = useState(1);
  const [note, setNote] = useState('');
  const [ivr, setIvr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!user) { setErr('Select a user'); return; }
    setBusy(true);
    setErr('');
    try {
      await apiPost('/alerts/subscription', { user_id: user.id, week_number: week, admin_note: note, ivr_message: ivr });
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create alert');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold">Add Failed Delivery Alert</h3>
        <div className="space-y-3 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">User</label>
            <UserPicker value={user} onChange={setUser} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Week</label>
            <select className="rounded border px-2 py-1" value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10))}>
              {[1, 2, 3, 4].map((w) => <option key={w} value={w}>Week {w}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Admin note</label>
            <textarea className="w-full rounded border px-2 py-1" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">IVR message (read to the customer)</label>
            <textarea className="w-full rounded border px-2 py-1" value={ivr} onChange={(e) => setIvr(e.target.value)} />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded border px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
          <button disabled={busy} className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700" onClick={submit}>Create</button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-indigo-500 text-indigo-600'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

export function AlertsPage() {
  const [activeAlertType, setActiveAlertType] = useState<AlertTypeTab>(ALERT_TYPE_TABS[0]);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | ''>('');
  const [typeCounts, setTypeCounts] = useState<Partial<Record<AlertTypeTab, number>>>({});
  const [typeCountsLoading, setTypeCountsLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminAlertRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusPopupAlertId, setStatusPopupAlertId] = useState<string | null>(null);
  const [statusEditDraft, setStatusEditDraft] = useState<AlertStatus>('new');
  const [statusAnchorEl, setStatusAnchorEl] = useState<HTMLElement | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusSaveError, setStatusSaveError] = useState<string | null>(null);
  // Subscription-tab filters.
  const [heardFilter, setHeardFilter] = useState<'' | 'heard' | 'unheard'>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userFilter, setUserFilter] = useState<{ id: string; name: string } | null>(null);
  const [showAddAlert, setShowAddAlert] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusDraft, setBulkStatusDraft] = useState<AlertStatus>('resolved');
  const [bulkStatusSaving, setBulkStatusSaving] = useState(false);
  const [bulkStatusError, setBulkStatusError] = useState<string | null>(null);

  const subActive = isSubscriptionAlertTab(activeAlertType);

  const subParams = (params: URLSearchParams) => {
    if (heardFilter) params.set('heard', heardFilter);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (userFilter) params.set('user_id', userFilter.id);
  };

  const refreshTypeCounts = async () => {
    setTypeCountsLoading(true);
    try {
      const entries = await Promise.all(
        ALERT_TYPE_TABS.map(async (alertType) => {
          const params = new URLSearchParams({ page: '1', per_page: '1', status: 'new' });
          if (isUserAlertTab(alertType)) {
            const r = await apiGet<ListResponse>(`/alerts/user?${params}`);
            return [alertType, r.total || 0] as const;
          }
          if (isSubscriptionAlertTab(alertType)) {
            params.set('alert_type', alertType);
            subParams(params);
            const r = await apiGet<ListResponse>(`/alerts/subscription?${params}`);
            return [alertType, r.total || 0] as const;
          }
          // Product Alerts tab: all catalog alert types, no alert_type filter.
          const r = await apiGet<ListResponse>(`/alerts?${params}`);
          return [alertType, r.total || 0] as const;
        }),
      );
      setTypeCounts(Object.fromEntries(entries) as Record<AlertTypeTab, number>);
    } catch {
      // Table fetch surfaces list errors; keep prior tab counts on count-only failure.
    } finally {
      setTypeCountsLoading(false);
    }
  };

  useEffect(() => {
    void refreshTypeCounts();
  }, [heardFilter, dateFrom, dateTo, userFilter?.id]);

  useEffect(() => {
    const onRefresh = () => void refreshTypeCounts();
    window.addEventListener('voicex:alerts-count-refresh', onRefresh);
    return () => window.removeEventListener('voicex:alerts-count-refresh', onRefresh);
  }, [heardFilter, dateFrom, dateTo, userFilter?.id]);

  const table = useAdminTableQuery<AdminAlertRow>({
    defaultSort: { field: 'created_at', dir: 'desc' },
    defaultPerPage: 20,
    filterKey: `${statusFilter}|${activeAlertType}|${heardFilter}|${dateFrom}|${dateTo}|${userFilter?.id || ''}`,
    fetcher: async ({ page, perPage, sortBy, sortDir }) => {
      try {
        const params = new URLSearchParams({
          page: String(page),
          per_page: String(perPage),
          sort_by: sortBy,
          sort_dir: sortDir,
        });
        if (statusFilter) params.set('status', statusFilter);
        let endpoint = '/alerts';
        if (isUserAlertTab(activeAlertType)) {
          endpoint = '/alerts/user';
        } else if (isSubscriptionAlertTab(activeAlertType)) {
          endpoint = '/alerts/subscription';
          params.set('alert_type', activeAlertType);
          subParams(params);
        }
        // Product Alerts tab: omit alert_type to list all catalog product alerts.
        const r = await apiGet<ListResponse>(`${endpoint}?${params}`);
        setError('');
        return { data: r.data || [], total: r.total || 0 };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load alerts');
        return { data: [], total: 0 };
      }
    },
  });
  const rows = table.rows;
  const { page, perPage, total, sortBy, sortDir, paginationMode } = table;

  const rowSelection = useRowSelection();
  const { selected, selectedCount, toggleOne, toggleAll, clear: clearSelection, isSelected, getSelectionState } = rowSelection;
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const { allSelected, someSelected } = getSelectionState(rowIds);

  useEffect(() => {
    clearSelection();
  }, [statusFilter, activeAlertType, heardFilter, dateFrom, dateTo, userFilter?.id, page, perPage, sortBy, sortDir, clearSelection]);

  const activeTabCount = typeCounts[activeAlertType];

  const closeStatusPopup = () => {
    setStatusPopupAlertId(null);
    setStatusAnchorEl(null);
    setStatusSaveError(null);
  };

  const toggleStatusPopup = (row: AdminAlertRow, anchor: HTMLElement) => {
    if (statusPopupAlertId === row.id) {
      closeStatusPopup();
      return;
    }
    setStatusSaveError(null);
    setStatusAnchorEl(anchor);
    setStatusPopupAlertId(row.id);
    setStatusEditDraft(row.status);
  };

  const handleStatusSave = async () => {
    if (!statusPopupAlertId) return;
    setStatusSaving(true);
    setStatusSaveError(null);
    try {
      const savedId = statusPopupAlertId;
      const savedStatus = statusEditDraft;
      await apiPatch(`/alerts/${savedId}`, { status: savedStatus });
      table.setRows((prev) => prev.map((x) => (x.id === savedId ? { ...x, status: savedStatus } : x)));
      emitAlertsCountRefresh();
      closeStatusPopup();
    } catch (err) {
      setStatusSaveError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setStatusSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/alerts/${deleteTarget.id}`);
      table.setRows((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      table.setTotal((t) => Math.max(0, t - 1));
      if (deleteTarget.status === 'new') {
        setTypeCounts((prev) => ({
          ...prev,
          [activeAlertType]: Math.max(0, (prev[activeAlertType] ?? 0) - 1),
        }));
      }
      setDeleteTarget(null);
      emitAlertsCountRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete alert');
    } finally {
      setDeleting(false);
    }
  };

  const adjustTypeCountForStatusChanges = (
    affectedRows: { id: string; status: AlertStatus }[],
    newStatus: AlertStatus,
  ) => {
    const selectedSet = new Set(Array.from(selected));
    const matching = affectedRows.filter((r) => selectedSet.has(r.id));
    let delta = 0;
    for (const row of matching) {
      if (row.status === 'new' && newStatus !== 'new') delta -= 1;
      if (row.status !== 'new' && newStatus === 'new') delta += 1;
    }
    if (delta !== 0) {
      setTypeCounts((prev) => ({
        ...prev,
        [activeAlertType]: Math.max(0, (prev[activeAlertType] ?? 0) + delta),
      }));
    }
  };

  const confirmBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    setBulkDeleteError(null);
    try {
      await apiDelete('/alerts', { ids });
      const deletedIds = new Set(ids);
      const deletedNewCount = rows.filter((r) => deletedIds.has(r.id) && r.status === 'new').length;
      table.setRows((prev) => prev.filter((x) => !deletedIds.has(x.id)));
      table.setTotal((t) => Math.max(0, t - ids.length));
      if (deletedNewCount > 0) {
        setTypeCounts((prev) => ({
          ...prev,
          [activeAlertType]: Math.max(0, (prev[activeAlertType] ?? 0) - deletedNewCount),
        }));
      }
      clearSelection();
      setBulkDeleteConfirm(false);
      closeStatusPopup();
      emitAlertsCountRefresh();
    } catch (err) {
      setBulkDeleteError(err instanceof Error ? err.message : 'Failed to delete alerts');
    } finally {
      setDeleting(false);
    }
  };

  const confirmBulkStatus = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkStatusSaving(true);
    setBulkStatusError(null);
    try {
      const newStatus = bulkStatusDraft;
      await apiPatch('/alerts', { ids, status: newStatus });
      adjustTypeCountForStatusChanges(rows, newStatus);
      const idSet = new Set(ids);
      table.setRows((prev) =>
        prev.map((x) => (idSet.has(x.id) ? { ...x, status: newStatus } : x)),
      );
      clearSelection();
      setBulkStatusOpen(false);
      closeStatusPopup();
      emitAlertsCountRefresh();
    } catch (err) {
      setBulkStatusError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setBulkStatusSaving(false);
    }
  };

  const bulkActions: BulkAction[] = useMemo(
    () => [
      {
        id: 'status',
        label: (count) => `Change status for ${count} alert${count === 1 ? '' : 's'}`,
        disabled: bulkStatusSaving || deleting,
        onRun: () => {
          setBulkStatusDraft('resolved');
          setBulkStatusError(null);
          setBulkStatusOpen(true);
        },
      },
      {
        id: 'delete',
        label: (count) => `Delete ${count} alert${count === 1 ? '' : 's'}`,
        icon: <Trash2 size={16} />,
        variant: 'danger',
        disabled: deleting || bulkStatusSaving,
        onRun: () => {
          setBulkDeleteError(null);
          setBulkDeleteConfirm(true);
        },
      },
    ],
    [deleting, bulkStatusSaving],
  );

  const checkboxHeader = (
    <th className="w-10 px-3 py-3">
      <SelectAllCheckbox
        checked={allSelected}
        indeterminate={someSelected}
        disabled={rows.length === 0}
        onChange={() => toggleAll(rowIds)}
        ariaLabel="Select all alerts on this page"
      />
    </th>
  );

  const checkboxCell = (rowId: string) => (
    <td className="px-3 py-3">
      <RowCheckbox
        checked={isSelected(rowId)}
        onChange={() => toggleOne(rowId)}
        ariaLabel="Select alert"
      />
    </td>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-800">Alerts</h2>
        <div className="flex items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                table.setPage(1);
                setStatusFilter(e.target.value as AlertStatus | '');
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="new">New</option>
              <option value="reviewing">Reviewing</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setShowAddAlert(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus size={16} /> Add Alert
          </button>
        </div>
      </div>

      {subActive && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-56">
            <label className="mb-1 block text-xs font-medium text-gray-500">User</label>
            <UserPicker value={userFilter} onChange={(u) => { table.setPage(1); setUserFilter(u); }} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Heard</label>
            <select value={heardFilter} onChange={(e) => { table.setPage(1); setHeardFilter(e.target.value as any); }} className="rounded-lg border px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="unheard">Unheard</option>
              <option value="heard">Heard</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">From</label>
            <input type="date" value={dateFrom} onChange={(e) => { table.setPage(1); setDateFrom(e.target.value); }} className="rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">To</label>
            <input type="date" value={dateTo} onChange={(e) => { table.setPage(1); setDateTo(e.target.value); }} className="rounded-lg border px-3 py-2 text-sm" />
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {ALERT_TYPE_TABS.map((alertType) => {
          const count = typeCounts[alertType];
          const isActive = activeAlertType === alertType;
          return (
            <TabButton
              key={alertType}
              active={isActive}
              onClick={() => {
                if (alertType === activeAlertType) return;
                table.setPage(1);
                setActiveAlertType(alertType);
              }}
            >
              <span className="inline-flex items-center gap-2">
                {alertTabLabel(alertType)}
                {((typeCountsLoading && count === undefined) || (count ?? 0) > 0) && (
                  <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-semibold tabular-nums leading-none text-white">
                    {typeCountsLoading && count === undefined ? '…' : count}
                  </span>
                )}
              </span>
            </TabButton>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <BulkActionBar selectedCount={selectedCount} actions={bulkActions} />

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        {subActive ? (
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              {checkboxHeader}
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Week</th>
              <th className="px-4 py-3 font-medium">Issue</th>
              <th className="px-4 py-3 font-medium">Heard</th>
              <SortHeader label="Created" field="created_at" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName="px-4 py-3 font-medium" />
              <SortHeader label="Alert Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="px-6 py-12 text-center text-gray-500">No alerts match your filters.</td></tr>
            ) : (
              rows.map((row: any) => {
                const user = row.user;
                const payload = row.payload || {};
                return (
                  <tr key={row.id} className="border-b hover:bg-gray-50">
                    {checkboxCell(row.id)}
                    <td className="px-4 py-3">
                      {user?.id ? (
                        <Link to={`/admin/users/${user.id}`} className="font-medium text-indigo-600 hover:underline">{user.name || 'Unknown'}</Link>
                      ) : (
                        <span className="text-gray-600">{user?.name || 'Unknown'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{user?.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{user?.email ?? '—'}</td>
                    <td className="px-4 py-3">{payload.week_number ? `Week ${payload.week_number}` : '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{payload.issue_type ? subscriptionAlertIssueLabel(payload.issue_type) : (row.message || '—')}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.heard_at ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {row.heard_at ? 'Heard' : 'Unheard'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(row.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={(e) => toggleStatusPopup(row, e.currentTarget)}
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold hover:ring-2 hover:ring-indigo-200 ${statusBadgeClass(row.status)} ${statusPopupAlertId === row.id ? 'ring-2 ring-indigo-400' : ''}`}
                        title="Edit alert status"
                      >
                        {statusLabel(row.status)}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" title="Delete alert" onClick={() => setDeleteTarget(row)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        ) : isUserAlertTab(activeAlertType) ? (
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              {checkboxHeader}
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Returns</th>
              <th className="px-4 py-3 font-medium">User Status</th>
              <SortHeader label="Created" field="created_at" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName="px-4 py-3 font-medium" />
              <SortHeader label="Alert Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} thClassName="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                  {activeTabCount === 0 && !typeCountsLoading ? 'No high returning user alerts.' : 'No alerts match your filters.'}
                </td>
              </tr>
            ) : (
              rows.map((row: any) => {
                const user = row.user;
                const count = user?.returns_count ?? (typeof row.payload?.return_count === 'number' ? row.payload.return_count : '—');
                const name = user?.name ?? (row.payload?.user_name as string) ?? 'Unknown user';
                return (
                  <tr key={row.id} className="border-b hover:bg-gray-50">
                    {checkboxCell(row.id)}
                    <td className="px-4 py-3">
                      {user ? (
                        <Link to={`/admin/users/${user.id}`} className="font-medium text-indigo-600 hover:underline">{name}</Link>
                      ) : (
                        <span className="text-gray-600">{name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{user?.email ?? '—'}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-red-600">{count}</td>
                    <td className="px-4 py-3 text-gray-600">{user?.status ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(row.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={(e) => toggleStatusPopup(row, e.currentTarget)}
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold hover:ring-2 hover:ring-indigo-200 ${statusBadgeClass(row.status)} ${statusPopupAlertId === row.id ? 'ring-2 ring-indigo-400' : ''}`}
                        title="Edit alert status"
                      >
                        {statusLabel(row.status)}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" title="Delete alert" onClick={() => setDeleteTarget(row)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        ) : isProductCatalogAlertTab(activeAlertType) ? (
        <table className="w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              {checkboxHeader}
              <th className="px-3 py-3 font-medium w-16">Image</th>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">VoiceX ID</th>
              <th className="px-4 py-3 font-medium">Product Status</th>
              <SortHeader
                label="Issue"
                field="alert_type"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={table.handleSort}
                thClassName="px-4 py-3 font-medium"
              />
              <th className="px-4 py-3 font-medium">ASIN</th>
              <th className="px-4 py-3 font-medium">Custom price</th>
              <th className="px-4 py-3 font-medium">Local price</th>
              <SortHeader
                label="Created"
                field="created_at"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={table.handleSort}
                thClassName="px-4 py-3 font-medium"
              />
              <SortHeader
                label="Alert Status"
                field="status"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={table.handleSort}
                thClassName="px-4 py-3 font-medium"
              />
              <th className="px-4 py-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-6 py-12 text-center text-gray-500">
                  {activeTabCount === 0 && !typeCountsLoading
                    ? 'No product alerts.'
                    : 'No alerts match your filters.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const p = row.catalog_products;
                const name = p ? getProductDisplayName(p) : 'Unknown product';
                const effective =
                  row.effective_custom_price_cents ??
                  (typeof row.payload.effective_custom_price_cents === 'number'
                    ? row.payload.effective_custom_price_cents
                    : null);
                const customCents =
                  p?.custom_price_cents ??
                  (typeof row.payload.custom_price_cents === 'number' ? row.payload.custom_price_cents : null);
                const customPriceDisplay =
                  row.alert_type === ADMIN_ALERT_TYPES.PRODUCT_MISSING_AMAZON_PRICE
                    ? customCents
                    : row.alert_type === ADMIN_ALERT_TYPES.PRODUCT_AMAZON_OUT_OF_STOCK ||
                        row.alert_type === ADMIN_ALERT_TYPES.PRODUCT_ASIN_NOT_FOUND
                      ? null
                      : effective;
                const availabilityStatus =
                  p?.amazon_availability_status ??
                  (typeof row.payload.amazon_availability_status === 'string'
                    ? row.payload.amazon_availability_status
                    : null);
                const local =
                  p?.local_price_cents ??
                  (typeof row.payload.local_price_cents === 'number' ? row.payload.local_price_cents : null);

                return (
                  <tr key={row.id} className="border-b hover:bg-gray-50">
                    {checkboxCell(row.id)}
                    <td className="px-3 py-2">
                      {p && !p.deleted_at ? (
                        <ProductThumbnail
                          thumbnailUrl={p.thumbnail_url ?? null}
                          images={p.amazon_image_urls}
                          alt={name}
                          size={48}
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">
                          —
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p && !p.deleted_at ? (
                        <Link to={`/admin/products/${p.id}`} className="font-medium text-indigo-600 hover:underline">
                          {name}
                        </Link>
                      ) : (
                        <span className="text-gray-600">{name}</span>
                      )}
                      {p?.deleted_at && (
                        <span className="ml-2 text-xs text-amber-600">(trashed)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">
                      {(p?.voicex_id as string | undefined) ?? (row.payload.voicex_id as string) ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {p && !p.deleted_at ? (
                        <CatalogProductStatusBadge
                          status={p.status}
                          frozenSource={p.frozen_source}
                          stacked
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {adminAlertTypeLabel(row.alert_type)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {(p?.amazon_asin as string | undefined) ?? (row.payload.amazon_asin as string) ?? '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {customPriceDisplay != null
                        ? formatUsdFromCents(customPriceDisplay)
                        : availabilityStatus
                          ? amazonAvailabilityStatusLabel(availabilityStatus)
                          : '—'}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-red-600">
                      {local != null ? formatUsdFromCents(local) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={(e) => toggleStatusPopup(row, e.currentTarget)}
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold hover:ring-2 hover:ring-indigo-200 ${statusBadgeClass(row.status)} ${
                          statusPopupAlertId === row.id ? 'ring-2 ring-indigo-400' : ''
                        }`}
                        title="Edit alert status"
                      >
                        {statusLabel(row.status)}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        title="Delete alert"
                        onClick={() => setDeleteTarget(row)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        ) : null}

        <EndlessTail
          paginationMode={paginationMode}
          hasMore={table.hasMoreEndless}
          isLoadingMore={table.isLoadingMore}
          total={total}
          sentinelRef={table.sentinelRef}
          itemLabel="alert"
        />

        <PaginationFooter
          page={page}
          perPage={perPage}
          total={total}
          loadedCount={rows.length}
          paginationMode={paginationMode}
          onPageChange={table.setPage}
          onPerPageChange={table.setPerPage}
          onPaginationModeChange={table.switchPaginationMode}
          itemLabel="Alert"
          itemLabelPlural="Alerts"
        />
      </div>

      <AlertStatusInlineEditor
        open={statusPopupAlertId !== null}
        anchorEl={statusAnchorEl}
        draftStatus={statusEditDraft}
        saving={statusSaving}
        saveError={statusSaveError}
        onDraftChange={setStatusEditDraft}
        onSave={() => void handleStatusSave()}
        onCancel={closeStatusPopup}
      />

      {showAddAlert && (
        <AddAlertModal
          onClose={() => setShowAddAlert(false)}
          onCreated={() => { table.refresh(); void refreshTypeCounts(); emitAlertsCountRefresh(); }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete alert</h3>
            </div>
            <p className="mb-6 text-sm text-gray-600">
              Remove this alert from the system? This does not change product prices.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">
                Delete {selectedCount} alert{selectedCount === 1 ? '' : 's'}?
              </h3>
            </div>
            <p className="mb-6 text-sm text-gray-600">
              Remove {selectedCount === 1 ? 'this alert' : `these ${selectedCount} alerts`} from the system?
              This does not change product prices.
            </p>
            {bulkDeleteError ? <p className="mb-4 text-sm text-red-600">{bulkDeleteError}</p> : null}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setBulkDeleteConfirm(false);
                  setBulkDeleteError(null);
                }}
                disabled={deleting}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmBulkDelete()}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : `Delete ${selectedCount} alert${selectedCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkStatusOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">
              Change status for {selectedCount} alert{selectedCount === 1 ? '' : 's'}
            </h3>
            <AlertStatusRadioGroup
              name="alert-status-bulk"
              value={bulkStatusDraft}
              onChange={setBulkStatusDraft}
            />
            {bulkStatusError ? <p className="mt-3 text-sm text-red-600">{bulkStatusError}</p> : null}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setBulkStatusOpen(false);
                  setBulkStatusError(null);
                }}
                disabled={bulkStatusSaving}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmBulkStatus()}
                disabled={bulkStatusSaving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {bulkStatusSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
