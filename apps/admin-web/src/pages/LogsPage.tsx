import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Trash2, AlertTriangle, AlertCircle, Info, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString();
}

function formatDuration(seconds: number) {
  if (seconds < 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatCents(cents: number | null | undefined) {
  if (cents == null) return '-';
  return `$${(cents / 100).toFixed(2)}`;
}

function LimitBadge({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? value / max : 0;
  const color = pct >= 0.8 ? 'text-red-700 bg-red-50' : pct >= 0.5 ? 'text-yellow-700 bg-yellow-50' : 'text-gray-600 bg-gray-50';
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono ${color}`}>
      {value}/{max} <span className="text-[10px] font-sans font-normal text-gray-400">{label}</span>
    </span>
  );
}

type TabId = 'ivr' | 'checkout';

export function LogsPage() {
  const [tab, setTab] = useState<TabId>('ivr');

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">Logs</h2>

      <div className="mb-4 flex gap-1 border-b">
        <TabButton active={tab === 'checkout'} onClick={() => setTab('checkout')}>
          Checkout Events
        </TabButton>
        <TabButton active={tab === 'ivr'} onClick={() => setTab('ivr')}>
          IVR Steps
        </TabButton>
      </div>

      {tab === 'ivr' && <IvrStepsView />}
      {tab === 'checkout' && <CheckoutEventsView />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
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

// ===========================================================================
// IVR Steps View (the existing logs view - unchanged behavior, refactored
// out of the page so we can add the tab toggle).
// ===========================================================================

function IvrStepsView() {
  const [calls, setCalls] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedSid, setExpandedSid] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const perPage = 25;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    apiGet<any>(`/logs/calls?${params}`).then((r) => {
      setCalls(r.data || []);
      setTotal(r.total || 0);
      setSelected(new Set());
    });
  };

  useEffect(() => { load(); }, [page, dateFrom, dateTo]);

  const toggleSelect = (callSid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(callSid)) next.delete(callSid);
      else next.add(callSid);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === calls.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(calls.map((c) => c.call_sid)));
    }
  };

  // Validate every sid is a real non-empty string before we send it. If the
  // selection state ever picked up an undefined / empty value, sending it could
  // (in theory) lead to a malformed filter on the server. Bail out loudly.
  const validateSids = (sids: string[]): string[] | null => {
    const cleaned: string[] = [];
    for (const s of sids) {
      if (typeof s !== 'string' || !s.trim()) {
        alert('Selection contains an invalid value. Please refresh the page and try again.');
        console.error('[logs] invalid sid in selection', sids);
        return null;
      }
      cleaned.push(s.trim());
    }
    return Array.from(new Set(cleaned));
  };

  const runDelete = async (callSids: string[]) => {
    const sids = validateSids(callSids);
    if (!sids || sids.length === 0) return;

    let preview: any = null;
    try {
      preview = await apiPost<any>('/logs/delete-preview', { call_sids: sids });
    } catch (e) {
      console.error('[logs] preview failed', e);
    }

    const callLabel = `${sids.length} call${sids.length === 1 ? '' : 's'}`;
    const message = preview
      ? [
          `Delete ${callLabel}?`,
          '',
          `This will permanently remove:`,
          `  • ${preview.step_rows} IVR step row${preview.step_rows === 1 ? '' : 's'}`,
          `  • ${preview.session_rows} call session${preview.session_rows === 1 ? '' : 's'}`,
          `  • ${preview.checkout_event_rows} checkout event${preview.checkout_event_rows === 1 ? '' : 's'}`,
          '',
          'Only the selected calls will be affected. Other calls are not touched.',
        ].join('\n')
      : `Delete logs for ${callLabel}? Other calls will not be affected.`;

    if (!confirm(message)) return;

    setDeleting(true);
    try {
      const r = await apiPost<any>('/logs/bulk-delete', {
        call_sids: sids,
        // If the server's row count has drifted from the preview, it will
        // refuse the delete (HTTP 409) and tell us to refresh. This blocks
        // the "expected to delete a few, accidentally deletes many" failure mode.
        expected_step_rows: preview?.step_rows,
      });
      console.info('[logs] bulk delete result', r);
      load();
    } catch (e: any) {
      alert(`Delete failed: ${e?.message || e}`);
      console.error('[logs] delete failed', e);
    } finally {
      setDeleting(false);
    }
  };

  const deleteOne = (callSid: string) => runDelete([callSid]);
  const bulkDelete = () => runDelete(Array.from(selected));

  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, total);
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div>
      <div className="mb-3 text-sm text-gray-600">
        {total === 0
          ? 'No calls'
          : <>Showing <span className="font-medium text-gray-800">{rangeStart}-{rangeEnd}</span> of <span className="font-medium text-gray-800">{total}</span> call{total !== 1 ? 's' : ''}</>}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm"
          placeholder="From"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm"
          placeholder="To"
        />
        {selected.size > 0 && (() => {
          const selectedStepRows = calls
            .filter((c) => selected.has(c.call_sid))
            .reduce((sum, c) => sum + (c.step_count || 0), 0);
          return (
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-gray-500">
                {selected.size} call{selected.size === 1 ? '' : 's'} selected
                {selectedStepRows > 0 && ` (${selectedStepRows} underlying step row${selectedStepRows === 1 ? '' : 's'})`}
              </span>
              <button
                onClick={bulkDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 size={14} />
                Delete {selected.size} selected
              </button>
            </div>
          );
        })()}
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={calls.length > 0 && selected.size === calls.length}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="w-8 px-1 py-3" />
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium">Caller</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Webhooks</th>
              <th className="px-4 py-3 font-medium">Actions</th>
              <th className="px-4 py-3 font-medium">Depth</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => {
              const isExpanded = expandedSid === call.call_sid;
              const steps = call.steps || [];

              return (
                <tr key={call.call_sid} className="group border-b">
                  <td colSpan={11} className="p-0">
                    <div className="flex items-center hover:bg-gray-50">
                      <div className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(call.call_sid)}
                          onChange={() => toggleSelect(call.call_sid)}
                          className="rounded border-gray-300"
                        />
                      </div>
                      <div
                        className="flex flex-1 cursor-pointer items-center"
                        onClick={() => setExpandedSid(isExpanded ? null : call.call_sid)}
                      >
                        <div className="w-8 px-1 py-3 text-gray-400">
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                        <div className="flex-1 px-4 py-3 text-gray-500">{formatDate(call.started_at)}</div>
                        <div className="flex-1 px-4 py-3 font-mono text-xs text-gray-500">
                          {call.caller_id || '-'}
                        </div>
                        <div className="flex-1 px-4 py-3">{call.user_name || '-'}</div>
                        <div className="flex-1 px-4 py-3">
                          <LimitBadge value={call.total_webhooks || 0} max={25} label="wh" />
                        </div>
                        <div className="flex-1 px-4 py-3">
                          <LimitBadge value={call.total_actions || 0} max={50} label="act" />
                        </div>
                        <div className="flex-1 px-4 py-3">
                          <LimitBadge value={call.max_recursion_depth || 0} max={10} label="dep" />
                        </div>
                        <div className="flex-1 px-4 py-3">
                          {call.duration_seconds != null ? formatDuration(call.duration_seconds) : '-'}
                        </div>
                        <div className="flex-1 px-4 py-3">
                          {call.has_ended ? (
                            <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">ended</span>
                          ) : (
                            <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700">no end detected</span>
                          )}
                        </div>
                      </div>
                      <div className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => deleteOne(call.call_sid)}
                          disabled={deleting}
                          className="rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t bg-gray-50 px-8 py-4 space-y-4">
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="font-medium text-gray-600">Call ID:</span>{' '}
                            <span className="font-mono text-xs">{call.call_sid}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">User ID:</span>{' '}
                            <span className="font-mono text-xs">{call.user_id || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Flow Version:</span>{' '}
                            <span className="font-mono text-xs">{call.flow_version_id || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Call Started:</span>{' '}
                            <span>{formatDate(call.started_at)}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Last Activity:</span>{' '}
                            <span>{formatDate(call.ended_at)}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Duration:</span>{' '}
                            <span>{call.duration_seconds != null ? formatDuration(call.duration_seconds) : 'N/A'}</span>
                          </div>
                        </div>

                        <div className="flex gap-6 rounded-lg bg-white p-3 text-sm">
                          <div>
                            <span className="font-medium text-gray-600">Webhooks:</span>{' '}
                            <LimitBadge value={call.total_webhooks || 0} max={25} label="/ 25 limit" />
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Actions:</span>{' '}
                            <LimitBadge value={call.total_actions || 0} max={50} label="/ 50 limit" />
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Max Recursion:</span>{' '}
                            <LimitBadge value={call.max_recursion_depth || 0} max={10} label="/ 10 limit" />
                          </div>
                        </div>

                        {steps.length > 0 && (
                          <div>
                            <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">
                              Call Steps ({steps.length})
                            </h4>
                            <div className="rounded-lg bg-gray-100 overflow-auto max-h-80">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b text-left text-gray-500 sticky top-0 bg-gray-100">
                                    <th className="px-3 py-1.5 font-medium w-8">#</th>
                                    <th className="px-3 py-1.5 font-medium">Time</th>
                                    <th className="px-3 py-1.5 font-medium">Node</th>
                                    <th className="px-3 py-1.5 font-medium">Digits</th>
                                    <th className="px-3 py-1.5 font-medium">Response</th>
                                    <th className="px-3 py-1.5 font-medium">Actions</th>
                                    <th className="px-3 py-1.5 font-medium">Depth</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {steps.map((step: any, idx: number) => (
                                    <tr key={idx} className="border-b border-gray-200">
                                      <td className="px-3 py-1.5 text-gray-400">{idx + 1}</td>
                                      <td className="px-3 py-1.5 text-gray-500">
                                        {step.time ? new Date(step.time).toLocaleTimeString() : '-'}
                                      </td>
                                      <td className="px-3 py-1.5 font-mono">{step.node}</td>
                                      <td className="px-3 py-1.5 font-mono text-indigo-600">
                                        {step.digits || '-'}
                                      </td>
                                      <td className="px-3 py-1.5">
                                        {step.response_type ? (
                                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                            step.response_type === 'gather' ? 'bg-blue-50 text-blue-600' :
                                            step.response_type === 'say+redirect' ? 'bg-purple-50 text-purple-600' :
                                            step.response_type === 'hangup' ? 'bg-red-50 text-red-600' :
                                            'bg-gray-50 text-gray-500'
                                          }`}>
                                            {step.response_type}
                                          </span>
                                        ) : '-'}
                                      </td>
                                      <td className="px-3 py-1.5 font-mono">
                                        {step.action_count > 0 ? step.action_count : '-'}
                                      </td>
                                      <td className="px-3 py-1.5 font-mono">
                                        {step.recursion_depth > 1 ? (
                                          <span className="text-orange-600">{step.recursion_depth}</span>
                                        ) : step.recursion_depth === 1 ? '1' : '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {calls.length === 0 && (
              <tr>
                <td colSpan={11} className="px-6 py-8 text-center text-gray-400">
                  No call logs found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <PaginationFooter
          page={page}
          totalPages={totalPages}
          total={total}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onChange={setPage}
        />
      </div>
    </div>
  );
}

function PaginationFooter({
  page,
  totalPages,
  total,
  rangeStart,
  rangeEnd,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  rangeStart: number;
  rangeEnd: number;
  onChange: (p: number) => void;
}) {
  const pages = getPageNumbers(page, totalPages);
  return (
    <div className="flex items-center justify-between border-t px-6 py-3">
      <span className="text-sm text-gray-500">
        {total === 0 ? 'No results' : `Showing ${rangeStart}-${rangeEnd} of ${total}`}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(1)}
          disabled={page === 1}
          className="rounded border px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          title="First page"
        >
          «
        </button>
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="rounded border px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          title="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`gap-${i}`} className="px-2 text-sm text-gray-400">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`min-w-[32px] rounded border px-2 py-1 text-sm ${
                p === page
                  ? 'border-indigo-500 bg-indigo-50 font-medium text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded border px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          title="Next page"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={() => onChange(totalPages)}
          disabled={page >= totalPages}
          className="rounded border px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          title="Last page"
        >
          »
        </button>
      </div>
    </div>
  );
}

// Build a compact list of page numbers around the current page,
// e.g. [1, '...', 4, 5, 6, '...', 12].
function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | '...')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('...');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('...');
  pages.push(total);
  return pages;
}

// ===========================================================================
// Checkout Events View
// ===========================================================================

const EVENT_TYPE_LABELS: Record<string, string> = {
  checkout_entered: 'Entered checkout',
  address_selected: 'Address selected',
  payment_method_selected: 'Payment method selected',
  rye_intent_created: 'Rye intent created',
  rye_intent_failed: 'Rye intent failed',
  rye_intent_unavailable: 'Rye intent: item unavailable',
  rye_intent_stock_issue: 'Rye intent: stock issue',
  unavailable_item_removed: 'Unavailable item removed',
  stock_item_removed: 'Stock-issue item removed',
  stock_item_qty_updated: 'Stock-issue qty updated',
  sola_auth_succeeded: 'Sola auth-only succeeded',
  sola_auth_failed: 'Sola auth-only failed',
  order_persisted: 'Order persisted',
  rye_confirm_succeeded: 'Rye drawdown confirmed',
  rye_confirm_failed: 'Rye drawdown failed',
  sola_capture_succeeded: 'Sola capture succeeded',
  sola_capture_failed: 'Sola capture failed',
  sola_void_release: 'Sola void/release',
  order_completed: 'Order completed',
  order_failed: 'Order failed',
  checkout_cancelled: 'Checkout cancelled',
};

function eventLabel(eventType: string) {
  return EVENT_TYPE_LABELS[eventType] || eventType;
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const config: Record<string, { color: string; icon: any; label: string }> = {
    in_progress: { color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle, label: 'in progress' },
    order_completed: { color: 'bg-green-100 text-green-700', icon: CheckCircle2, label: 'order completed' },
    order_failed: { color: 'bg-red-100 text-red-700', icon: XCircle, label: 'order failed' },
    cancelled: { color: 'bg-gray-100 text-gray-600', icon: MinusCircle, label: 'cancelled' },
    cart_review_needed: { color: 'bg-orange-100 text-orange-700', icon: AlertTriangle, label: 'needs review' },
  };
  const c = config[outcome] || config.in_progress;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${c.color}`}>
      <Icon size={11} />
      {c.label}
    </span>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'error') return <XCircle size={14} className="text-red-500" />;
  if (severity === 'warn') return <AlertTriangle size={14} className="text-orange-500" />;
  return <Info size={14} className="text-blue-400" />;
}

function CheckoutEventsView() {
  const [calls, setCalls] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedSid, setExpandedSid] = useState<string | null>(null);
  const perPage = 25;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    apiGet<any>(`/logs/checkout?${params}`).then((r) => {
      setCalls(r.data || []);
      setTotal(r.total || 0);
    });
  };

  useEffect(() => { load(); }, [page, dateFrom, dateTo]);

  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, total);
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div>
      <div className="mb-3 text-sm text-gray-600">
        {total === 0
          ? 'No calls'
          : <>Showing <span className="font-medium text-gray-800">{rangeStart}-{rangeEnd}</span> of <span className="font-medium text-gray-800">{total}</span> call{total !== 1 ? 's' : ''}</>}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm"
        />
        <span className="text-xs text-gray-500">
          Only calls that reached the checkout flow appear here. Use the IVR Steps tab for the per-call keypad trail.
        </span>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="w-8 px-1 py-3" />
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium">Caller</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Events</th>
              <th className="px-4 py-3 font-medium">Issues</th>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => {
              const isExpanded = expandedSid === call.call_sid;
              return (
                <tr key={call.call_sid} className="border-b">
                  <td colSpan={8} className="p-0">
                    <div
                      className="flex cursor-pointer items-center hover:bg-gray-50"
                      onClick={() => setExpandedSid(isExpanded ? null : call.call_sid)}
                    >
                      <div className="w-8 px-1 py-3 text-gray-400">
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                      <div className="flex-1 px-4 py-3 text-gray-600">{formatDate(call.started_at)}</div>
                      <div className="flex-1 px-4 py-3 font-mono text-xs text-gray-500">{call.caller_id || '-'}</div>
                      <div className="flex-1 px-4 py-3">{call.user_name || '-'}</div>
                      <div className="flex-1 px-4 py-3 font-mono text-xs text-gray-600">{call.event_count}</div>
                      <div className="flex-1 px-4 py-3">
                        {call.error_count > 0 && (
                          <span className="mr-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-50 text-red-700">
                            <XCircle size={10} /> {call.error_count}
                          </span>
                        )}
                        {call.warn_count > 0 && (
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-50 text-orange-700">
                            <AlertTriangle size={10} /> {call.warn_count}
                          </span>
                        )}
                        {call.error_count === 0 && call.warn_count === 0 && (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </div>
                      <div className="flex-1 px-4 py-3 font-mono text-xs text-gray-500">
                        {call.order_id ? call.order_id.slice(-6).toUpperCase() : '-'}
                      </div>
                      <div className="flex-1 px-4 py-3">
                        <OutcomeBadge outcome={call.outcome} />
                      </div>
                    </div>

                    {isExpanded && <CheckoutEventTimeline call={call} />}
                  </td>
                </tr>
              );
            })}
            {calls.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-gray-400">
                  No checkout events found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <PaginationFooter
          page={page}
          totalPages={totalPages}
          total={total}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onChange={setPage}
        />
      </div>
    </div>
  );
}

function CheckoutEventTimeline({ call }: { call: any }) {
  return (
    <div className="border-t bg-gray-50 px-8 py-4 space-y-3">
      <div className="grid grid-cols-3 gap-4 text-xs">
        <div>
          <span className="font-medium text-gray-600">Call ID:</span>{' '}
          <span className="font-mono">{call.call_sid}</span>
        </div>
        <div>
          <span className="font-medium text-gray-600">User ID:</span>{' '}
          <span className="font-mono">{call.user_id || 'N/A'}</span>
        </div>
        <div>
          <span className="font-medium text-gray-600">Order ID:</span>{' '}
          <span className="font-mono">{call.order_id || 'N/A'}</span>
        </div>
      </div>

      <div className="rounded-lg border bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="w-8 px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium w-24">Time</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {(call.events || []).map((ev: any) => (
              <tr key={ev.id} className="border-b last:border-0 align-top">
                <td className="px-3 py-2"><SeverityIcon severity={ev.severity} /></td>
                <td className="px-3 py-2 font-mono text-gray-500">{formatTime(ev.created_at)}</td>
                <td className="px-3 py-2 font-medium text-gray-700">{eventLabel(ev.event_type)}</td>
                <td className="px-3 py-2"><EventDetails event={ev} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EventDetails({ event }: { event: any }) {
  const d = event.details || {};

  switch (event.event_type) {
    case 'checkout_entered':
      return <span className="text-gray-600">Saved addresses: {d.saved_address_count ?? 0}</span>;

    case 'address_selected':
      return (
        <span className="text-gray-600">
          {d.source === 'saved' ? 'Used saved address' : `New address (${d.city}, ${d.state} ${d.zip})`}
          {d.validated === false && <span className="ml-2 text-orange-600">(unvalidated)</span>}
        </span>
      );

    case 'payment_method_selected':
      return (
        <span className="text-gray-600">
          {d.source === 'saved' ? 'Selected saved card' : 'Saved new card'}
          {d.card_brand && d.card_last4 && ` — ${d.card_brand} ····${d.card_last4}`}
        </span>
      );

    case 'rye_intent_created':
      return <RyeIntentCreatedDetails d={d} />;

    case 'rye_intent_failed':
      return (
        <div className="space-y-1 text-gray-700">
          <div>
            Reason: <span className="font-mono text-red-700">{d.reason_code || d.stage || 'unknown'}</span>
          </div>
          {d.failure_reason?.message && (
            <div className="text-gray-600">"{d.failure_reason.message}"</div>
          )}
          {d.error && <div className="text-gray-500">{String(d.error)}</div>}
        </div>
      );

    case 'rye_intent_unavailable':
      return (
        <div className="space-y-2 text-gray-700">
          <div>
            Rye reported <span className="font-mono">product_not_found</span>.
            Recovery cycle: <span className="font-mono">{d.recovery_cycle ?? 0}</span>
          </div>
          {Array.isArray(d.unavailable_failures) && d.unavailable_failures.length > 0 && (
            <div>
              <div className="text-xs font-medium text-red-700 mb-0.5">
                Unavailable item{d.unavailable_failures.length === 1 ? '' : 's'}:
              </div>
              <ul className="text-xs text-gray-700 list-disc ml-5 space-y-0.5">
                {d.unavailable_failures.map((f: any, i: number) => (
                  <li key={i}>
                    <span className="font-medium">{f.product_name || '(unidentified)'}</span>
                    {f.voicex_id && <span className="text-gray-400 font-mono"> #{f.voicex_id}</span>}
                    <span className="text-red-700 ml-1">({f.failure_code})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <CartItemsStatusTable items={d.items} />
        </div>
      );

    case 'rye_intent_stock_issue':
      return (
        <div className="space-y-2 text-gray-700">
          {Array.isArray(d.stock_failures) && d.stock_failures.length > 0 && (
            <div>
              <div className="text-xs font-medium text-orange-700 mb-0.5">
                Item{d.stock_failures.length === 1 ? '' : 's'} with stock issue:
              </div>
              <ul className="text-xs text-gray-700 list-disc ml-5 space-y-0.5">
                {d.stock_failures.map((f: any, i: number) => (
                  <li key={i}>
                    <span className="font-medium">{f.product_name || f.product_url}</span>
                    {f.voicex_id && <span className="text-gray-400 font-mono"> #{f.voicex_id}</span>}
                    <span className="ml-1 text-orange-700">
                      ({f.type === 'out_of_stock' ? 'out of stock' : f.type === 'insufficient_stock' ? 'insufficient stock' : f.type})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <CartItemsStatusTable items={d.items} />
        </div>
      );

    case 'unavailable_item_removed':
    case 'stock_item_removed':
      return (
        <div className="text-gray-700">
          Removed: <span className="font-medium">{d.product_name || d.voicex_id || d.cart_item_id}</span>
          {d.quantity != null && <span className="text-gray-500"> (qty {d.quantity})</span>}
          {d.reason && <span className="ml-2 text-xs font-mono text-gray-500">[{d.reason}]</span>}
        </div>
      );

    case 'stock_item_qty_updated':
      return (
        <span className="text-gray-700">
          Quantity updated to <span className="font-mono">{d.new_quantity}</span>
          <span className="ml-2 text-xs text-gray-500">(retry #{d.retry_count})</span>
        </span>
      );

    case 'sola_auth_succeeded':
    case 'sola_capture_succeeded':
      return (
        <span className="text-gray-700">
          {formatCents(d.amount_cents)} on ····{d.card_last4}
          <span className="ml-2 text-xs font-mono text-gray-500">ref {d.sola_ref_num}</span>
        </span>
      );

    case 'sola_auth_failed':
      return (
        <div className="space-y-0.5 text-gray-700">
          <div>{formatCents(d.amount_cents)} on ····{d.card_last4} — declined</div>
          {d.x_error && <div className="text-xs text-red-600">"{d.x_error}"</div>}
          {d.error && <div className="text-xs text-red-600">{String(d.error)}</div>}
        </div>
      );

    case 'sola_capture_failed':
      return (
        <div className="space-y-0.5 text-gray-700">
          <div className="font-medium text-red-700">CRITICAL: capture failed after Rye succeeded</div>
          <div className="text-xs">{formatCents(d.amount_cents)} on ····{d.card_last4}</div>
          <div className="text-xs font-mono text-gray-500">ref {d.sola_ref_num}</div>
          {d.error && <div className="text-xs text-red-600">{String(d.error)}</div>}
          {d.note && <div className="text-xs text-gray-600">{d.note}</div>}
        </div>
      );

    case 'sola_void_release':
      return (
        <div className="text-gray-700">
          Released hold of {formatCents(d.amount_cents)}
          <span className="ml-2 text-xs font-mono text-gray-500">ref {d.sola_ref_num}</span>
          {d.error && <div className="mt-1 text-xs text-red-600">{String(d.error)}</div>}
        </div>
      );

    case 'order_persisted':
      return (
        <div className="space-y-1 text-gray-700">
          <div>
            Order <span className="font-mono">{(d.order_id || '').slice(-6).toUpperCase()}</span> created
            with {d.item_count} item{d.item_count === 1 ? '' : 's'} — total {formatCents(d.total_cents)}
          </div>
          {Array.isArray(d.items) && (
            <table className="w-full text-[11px] border rounded">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-2 py-1 text-left font-medium">Item</th>
                  <th className="px-2 py-1 text-right font-medium">Qty</th>
                  <th className="px-2 py-1 text-right font-medium">Unit (charged)</th>
                  <th className="px-2 py-1 text-right font-medium">Amazon (at-add)</th>
                  <th className="px-2 py-1 text-right font-medium">Line</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((it: any, i: number) => {
                  // If our charged unit price is less than the Amazon price
                  // we recorded at admin-add time, we're losing money on this
                  // line. Highlight the row so it's hard to miss.
                  const losingMargin =
                    it.amazon_price_cents != null &&
                    it.unit_price_cents != null &&
                    it.unit_price_cents < it.amazon_price_cents;
                  return (
                    <tr key={i} className={`border-t ${losingMargin ? 'bg-red-50' : ''}`} title={losingMargin ? 'Charged price is below the Amazon price snapshotted when this product was added.' : undefined}>
                      <td className="px-2 py-1">
                        {it.product_name}
                        {it.voicex_id && <span className="ml-1 text-gray-400 font-mono">#{it.voicex_id}</span>}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{it.quantity}</td>
                      <td className={`px-2 py-1 text-right font-mono ${losingMargin ? 'text-red-700 font-medium' : ''}`}>
                        {formatCents(it.unit_price_cents)}
                      </td>
                      <td className={`px-2 py-1 text-right font-mono ${losingMargin ? 'text-red-700' : 'text-gray-500'}`}>
                        {formatCents(it.amazon_price_cents)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{formatCents(it.line_total_cents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      );

    case 'rye_confirm_succeeded':
    case 'rye_confirm_failed':
      return <RyeConfirmDetails d={d} />;

    case 'order_completed':
      return (
        <span className="text-gray-700">
          Order <span className="font-mono">{(d.order_id || '').slice(-6).toUpperCase()}</span> finalized
          {d.manual_review && <span className="ml-2 inline-block rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">manual review</span>}
        </span>
      );

    case 'order_failed':
      return (
        <span className="text-gray-700">
          Order failed{d.reason && <span className="ml-1 text-xs font-mono text-gray-500">({d.reason})</span>}
        </span>
      );

    case 'checkout_cancelled':
      return <span className="text-gray-600">User cancelled at <span className="font-mono">{d.stage || 'unknown'}</span></span>;

    default:
      return (
        <details>
          <summary className="cursor-pointer text-xs text-gray-500">show JSON</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-gray-100 p-2 text-[10px]">{JSON.stringify(d, null, 2)}</pre>
        </details>
      );
  }
}

/**
 * Compact good-vs-bad table for Rye intent items[].
 * Used wherever we want to show the full set of items with per-item
 * status (good = pending/completed, bad = failed with failure_code).
 */
function CartItemsStatusTable({ items }: { items: any[] | undefined }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <table className="w-full text-[11px] border rounded">
      <thead>
        <tr className="bg-gray-50">
          <th className="px-2 py-1 text-left font-medium">Item</th>
          <th className="px-2 py-1 text-right font-medium">Qty</th>
          <th className="px-2 py-1 text-left font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it: any, i: number) => {
          const isFailed = it.status === 'failed';
          return (
            <tr key={i} className={`border-t ${isFailed ? 'bg-red-50' : ''}`}>
              <td className="px-2 py-1">
                <span className="font-medium">{it.product_name || it.product_url}</span>
                {it.voicex_id && <span className="ml-1 text-gray-400 font-mono">#{it.voicex_id}</span>}
              </td>
              <td className="px-2 py-1 text-right font-mono">{it.quantity}</td>
              <td className="px-2 py-1">
                {isFailed ? (
                  <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                    <XCircle size={11} />
                    failed
                    {it.failure_code && <span className="text-[10px] font-normal text-red-600">({it.failure_code})</span>}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <CheckCircle2 size={11} />
                    {it.status}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RyeIntentCreatedDetails({ d }: { d: any }) {
  return (
    <div className="space-y-1 text-gray-700">
      <div className="font-mono text-xs text-gray-500">{d.rye_intent_id}</div>
      <div>
        Subtotal {formatCents(d.customer_subtotal_cents)}, shipping {formatCents(d.shipping_cents)},
        tax {formatCents(d.tax_cents)} → <span className="font-medium">total {formatCents(d.customer_total_cents)}</span>
      </div>
      {Array.isArray(d.cart_items) && (
        <table className="w-full text-[11px] border rounded">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-2 py-1 text-left font-medium">Item</th>
              <th className="px-2 py-1 text-right font-medium">Qty</th>
              <th className="px-2 py-1 text-right font-medium">Unit</th>
              <th className="px-2 py-1 text-right font-medium">Line</th>
            </tr>
          </thead>
          <tbody>
            {d.cart_items.map((it: any, i: number) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1">{it.product_name}</td>
                <td className="px-2 py-1 text-right font-mono">{it.quantity}</td>
                <td className="px-2 py-1 text-right font-mono">{formatCents(it.unit_price_cents)}</td>
                <td className="px-2 py-1 text-right font-mono">{formatCents(it.line_total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RyeConfirmDetails({ d }: { d: any }) {
  const offer = d.rye_final_offer;
  const items = d.rye_items || [];

  return (
    <div className="space-y-1 text-gray-700">
      <div className="font-mono text-xs text-gray-500">{d.rye_intent_id}</div>
      <div>
        Rye state: <span className="font-mono">{d.rye_state || 'unknown'}</span>
        {d.rye_order_id && <span className="ml-2 text-xs">→ Amazon order <span className="font-mono">{d.rye_order_id}</span></span>}
      </div>
      {offer && (
        <div className="rounded bg-gray-100 p-2 text-xs space-y-0.5">
          <div className="font-medium text-gray-700">Final pricing from Rye/Amazon:</div>
          <div>Subtotal: {formatCents(offer.subtotal?.amountSubunits)}</div>
          <div>Tax: {formatCents(offer.tax?.amountSubunits)}</div>
          {offer.shipping && <div>Shipping: {formatCents(offer.shipping.amountSubunits)}</div>}
          {offer.surcharge && <div>Surcharge: {formatCents(offer.surcharge.amountSubunits)}</div>}
          <div className="font-medium">
            Amazon total: {formatCents(offer.total?.amountSubunits)}
            {d.customer_total_cents != null && (
              <span className="ml-2 text-gray-500">
                (we charged customer {formatCents(d.customer_total_cents)} —
                margin{' '}
                <span className={
                  d.customer_total_cents - (offer.total?.amountSubunits ?? 0) >= 0
                    ? 'text-green-700'
                    : 'text-red-700 font-medium'
                }>
                  {formatCents(d.customer_total_cents - (offer.total?.amountSubunits ?? 0))}
                </span>)
              </span>
            )}
          </div>
        </div>
      )}
      {items.length > 0 && (
        <table className="w-full text-[11px] border rounded">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-2 py-1 text-left font-medium">Product URL</th>
              <th className="px-2 py-1 text-right font-medium">Qty</th>
              <th className="px-2 py-1 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, i: number) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1 font-mono text-[10px] text-gray-600 truncate max-w-xs">{it.product_url}</td>
                <td className="px-2 py-1 text-right font-mono">{it.quantity}</td>
                <td className="px-2 py-1">
                  <span className={
                    it.status === 'completed' ? 'text-green-700' :
                    it.status === 'failed' ? 'text-red-700' :
                    'text-gray-600'
                  }>
                    {it.status}
                    {it.failure_code && <span className="ml-1 text-[10px] text-red-600">({it.failure_code})</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.failure_reason && (
        <div className="rounded bg-red-50 p-2 text-xs">
          <div className="font-medium text-red-700">Failure: {d.failure_reason.code}</div>
          <div className="text-red-600">"{d.failure_reason.message}"</div>
        </div>
      )}
      {d.error && !d.failure_reason && (
        <div className="rounded bg-red-50 p-2 text-xs text-red-700">{String(d.error)}</div>
      )}
    </div>
  );
}
