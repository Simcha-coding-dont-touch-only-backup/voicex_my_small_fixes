import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

const ERROR_TYPE_STYLES: Record<string, string> = {
  loop_detected: 'bg-red-100 text-red-700',
  webhook_failure: 'bg-orange-100 text-orange-700',
  collect_failed: 'bg-yellow-100 text-yellow-700',
  file_not_found: 'bg-gray-100 text-gray-600',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

export function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [errorType, setErrorType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const perPage = 25;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (errorType) params.set('error_type', errorType);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    apiGet<any>(`/logs?${params}`).then((r) => {
      setLogs(r.data || []);
      setTotal(r.total || 0);
    });
  };

  useEffect(() => { load(); }, [page, errorType, dateFrom, dateTo]);

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">IVR Error Logs</h2>

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={errorType}
          onChange={(e) => { setErrorType(e.target.value); setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">All Error Types</option>
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
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="w-8 px-3 py-3" />
              <th className="px-6 py-3 font-medium">Date/Time</th>
              <th className="px-6 py-3 font-medium">Error Type</th>
              <th className="px-6 py-3 font-medium">Caller</th>
              <th className="px-6 py-3 font-medium">User</th>
              <th className="px-6 py-3 font-medium">Node</th>
              <th className="px-6 py-3 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const isExpanded = expandedId === log.id;
              return (
                <tr key={log.id} className="group border-b">
                  <td colSpan={7} className="p-0">
                    <div
                      className="flex cursor-pointer items-center hover:bg-gray-50"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    >
                      <div className="w-8 px-3 py-3 text-gray-400">
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
                      <div className="flex-1 px-6 py-3 font-mono text-xs">{log.node_key || '-'}</div>
                      <div className="flex-1 px-6 py-3 text-gray-500 truncate max-w-xs">
                        {log.error_detail || '-'}
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
                          <div>
                            <span className="font-medium text-gray-600">Flow Version:</span>{' '}
                            <span className="font-mono text-xs">{log.flow_version_id || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Error Detail:</span>{' '}
                            <span className="text-gray-700">{log.error_detail || 'N/A'}</span>
                          </div>
                        </div>

                        {log.session_data && Object.keys(log.session_data).length > 0 && (
                          <div>
                            <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">Session Data</h4>
                            <pre className="rounded-lg bg-gray-100 p-3 text-xs text-gray-700 overflow-auto max-h-48">
                              {JSON.stringify(log.session_data, null, 2)}
                            </pre>
                          </div>
                        )}

                        {log.raw_payload && (
                          <div>
                            <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">Raw TelTech Payload</h4>
                            <pre className="rounded-lg bg-gray-100 p-3 text-xs text-gray-700 overflow-auto max-h-48">
                              {JSON.stringify(log.raw_payload, null, 2)}
                            </pre>
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
                <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                  No error logs found
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
