import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

function formatDuration(seconds: number) {
  if (seconds < 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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

export function LogsPage() {
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

  const deleteOne = async (callSid: string) => {
    if (!confirm('Delete all logs for this call?')) return;
    setDeleting(true);
    try {
      await apiPost('/logs/bulk-delete', { call_sids: [callSid] });
      load();
    } finally {
      setDeleting(false);
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete all logs for ${selected.size} call${selected.size > 1 ? 's' : ''}?`)) return;
    setDeleting(true);
    try {
      await apiPost('/logs/bulk-delete', { call_sids: Array.from(selected) });
      load();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">IVR Call Logs</h2>

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
        {selected.size > 0 && (
          <button
            onClick={bulkDelete}
            disabled={deleting}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 size={14} />
            Delete {selected.size} selected
          </button>
        )}
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
                          <LimitBadge value={call.max_recursion_depth || 0} max={100} label="dep" />
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
                            <LimitBadge value={call.max_recursion_depth || 0} max={100} label="/ 100 limit" />
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

        <div className="flex items-center justify-between border-t px-6 py-3">
          <span className="text-sm text-gray-500">{total} call{total !== 1 ? 's' : ''}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1 text-sm">Page {page}</span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page * perPage >= total}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
