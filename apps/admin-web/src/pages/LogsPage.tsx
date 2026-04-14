import { useEffect, useState } from 'react';
import { apiGet, apiDelete, apiPost } from '../lib/api';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

const ERROR_TYPE_STYLES: Record<string, string> = {
  call_trace: 'bg-blue-100 text-blue-700',
  loop_detected: 'bg-red-100 text-red-700',
  high_webhook_count: 'bg-red-100 text-red-700',
  webhook_failure: 'bg-orange-100 text-orange-700',
  collect_failed: 'bg-yellow-100 text-yellow-700',
  file_not_found: 'bg-gray-100 text-gray-600',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [errorType, setErrorType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const perPage = 25;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (errorType) params.set('error_type', errorType);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    apiGet<any>(`/logs?${params}`).then((r) => {
      setLogs(r.data || []);
      setTotal(r.total || 0);
      setSelected(new Set());
    });
  };

  useEffect(() => { load(); }, [page, errorType, dateFrom, dateTo]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === logs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(logs.map((l) => l.id)));
    }
  };

  const deleteOne = async (id: string) => {
    if (!confirm('Delete this log entry?')) return;
    setDeleting(true);
    try {
      await apiDelete(`/logs/${id}`);
      load();
    } finally {
      setDeleting(false);
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} log${selected.size > 1 ? 's' : ''}?`)) return;
    setDeleting(true);
    try {
      await apiPost('/logs/bulk-delete', { ids: Array.from(selected) });
      load();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">IVR Call Logs</h2>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={errorType}
          onChange={(e) => { setErrorType(e.target.value); setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">All Types</option>
          <option value="call_trace">Call Trace</option>
          <option value="loop_detected">Loop Detected</option>
          <option value="webhook_failure">Webhook Failure</option>
          <option value="collect_failed">Collect Failed</option>
          <option value="file_not_found">File Not Found</option>
        </select>
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
                  checked={logs.length > 0 && selected.size === logs.length}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="w-8 px-1 py-3" />
              <th className="px-6 py-3 font-medium">Date/Time</th>
              <th className="px-6 py-3 font-medium">Type</th>
              <th className="px-6 py-3 font-medium">Caller</th>
              <th className="px-6 py-3 font-medium">User</th>
              <th className="px-6 py-3 font-medium">Steps</th>
              <th className="px-6 py-3 font-medium">Duration</th>
              <th className="px-6 py-3 font-medium">End Reason</th>
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const isExpanded = expandedId === log.id;
              const sd = log.session_data || {};
              const steps = sd.steps || [];
              const duration = sd.duration_seconds;
              const endReason = sd.end_reason;
              const webhookCount = sd.webhook_count;

              return (
                <tr key={log.id} className="group border-b">
                  <td colSpan={10} className="p-0">
                    <div className="flex items-center hover:bg-gray-50">
                      <div className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(log.id)}
                          onChange={() => toggleSelect(log.id)}
                          className="rounded border-gray-300"
                        />
                      </div>
                      <div
                        className="flex flex-1 cursor-pointer items-center"
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      >
                        <div className="w-8 px-1 py-3 text-gray-400">
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                        <div className="flex-1 px-6 py-3 text-gray-500">{formatDate(log.created_at)}</div>
                        <div className="flex-1 px-6 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            ERROR_TYPE_STYLES[log.error_type] || 'bg-gray-100 text-gray-600'
                          }`}>
                            {log.error_type}
                          </span>
                        </div>
                        <div className="flex-1 px-6 py-3 font-mono text-xs text-gray-500">
                          {log.caller_id || '-'}
                        </div>
                        <div className="flex-1 px-6 py-3">{log.user_name || '-'}</div>
                        <div className="flex-1 px-6 py-3">
                          {webhookCount != null ? `${webhookCount} webhooks` : '-'}
                        </div>
                        <div className="flex-1 px-6 py-3">
                          {duration != null ? formatDuration(duration) : '-'}
                        </div>
                        <div className="flex-1 px-6 py-3">
                          {endReason ? (
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              endReason === 'hangup' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {endReason}
                            </span>
                          ) : '-'}
                        </div>
                      </div>
                      <div className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => deleteOne(log.id)}
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
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="font-medium text-gray-600">Call ID:</span>{' '}
                            <span className="font-mono text-xs">{log.call_sid}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">User ID:</span>{' '}
                            <span className="font-mono text-xs">{log.user_id || 'N/A'}</span>
                          </div>
                          {sd.started_at && (
                            <div>
                              <span className="font-medium text-gray-600">Call Started:</span>{' '}
                              <span>{formatDate(sd.started_at)}</span>
                            </div>
                          )}
                          {sd.ended_at && (
                            <div>
                              <span className="font-medium text-gray-600">Call Ended:</span>{' '}
                              <span>{formatDate(sd.ended_at)}</span>
                            </div>
                          )}
                          <div>
                            <span className="font-medium text-gray-600">Last Node:</span>{' '}
                            <span className="font-mono text-xs">{log.node_key || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Flow Version:</span>{' '}
                            <span className="font-mono text-xs">{log.flow_version_id || 'N/A'}</span>
                          </div>
                        </div>

                        {steps.length > 0 && (
                          <div>
                            <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">
                              Call Steps ({steps.length})
                            </h4>
                            <div className="rounded-lg bg-gray-100 overflow-auto max-h-64">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b text-left text-gray-500">
                                    <th className="px-3 py-1.5 font-medium w-8">#</th>
                                    <th className="px-3 py-1.5 font-medium">Time</th>
                                    <th className="px-3 py-1.5 font-medium">Node</th>
                                    <th className="px-3 py-1.5 font-medium">Digits</th>
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
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {log.error_detail && (
                          <div>
                            <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">Summary</h4>
                            <p className="text-sm text-gray-700">{log.error_detail}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {logs.length === 0 && (
              <tr>
                <td colSpan={10} className="px-6 py-8 text-center text-gray-400">
                  No logs found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t px-6 py-3">
          <span className="text-sm text-gray-500">{total} log{total !== 1 ? 's' : ''}</span>
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
