import { useState } from 'react';
import { apiGet, apiDownload } from '../lib/api';
import { Download, FileSpreadsheet } from 'lucide-react';

type ReportType = 'purchases' | 'returned-items';

const REPORT_TABS: { id: ReportType; label: string }[] = [
  { id: 'purchases', label: 'Purchases' },
  { id: 'returned-items', label: 'Returned Items' },
];

export function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('purchases');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const switchReport = (type: ReportType) => {
    if (type === reportType) return;
    setReportType(type);
    setData(null);
  };

  const buildParams = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    return params;
  };

  const handleLoad = async () => {
    setLoading(true);
    try {
      const res = await apiGet<any>(`/reports/${reportType}?${buildParams()}`);
      setData(res.data || []);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    const filename = reportType === 'purchases' ? 'purchases-report.xlsx' : 'returned-items-report.xlsx';
    await apiDownload(`/reports/${reportType}/export?${buildParams()}`, filename);
  };

  const title = reportType === 'purchases' ? 'Purchase Report' : 'Returned Items Report';
  const emptyLabel = reportType === 'purchases' ? 'No purchases in this date range' : 'No returns in this date range';

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">Reports</h2>

      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => switchReport(tab.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              reportType === tab.id
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm text-gray-600">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="rounded border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="rounded border px-3 py-2 text-sm" />
          </div>
          <button onClick={handleLoad} disabled={loading}
            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
            {loading ? 'Loading...' : 'View Report'}
          </button>
          {data && data.length > 0 && (
            <button onClick={handleExport}
              className="flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700">
              <Download size={16} /> Export Excel
            </button>
          )}
        </div>
      </div>

      {data !== null && (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          {data.length === 0 ? (
            <div className="flex items-center justify-center gap-3 py-12 text-gray-400">
              <FileSpreadsheet size={24} />
              <span>{emptyLabel}</span>
            </div>
          ) : reportType === 'purchases' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-500">
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Customer</th>
                  <th className="px-6 py-3 font-medium">Product</th>
                  <th className="px-6 py-3 font-medium">VoiceX ID</th>
                  <th className="px-6 py-3 font-medium">Qty</th>
                  <th className="px-6 py-3 font-medium">Unit Price</th>
                  <th className="px-6 py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item: any, idx: number) => (
                  <tr key={idx} className="border-b">
                    <td className="px-6 py-3 text-gray-500">{new Date(item.orders?.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-3">{item.orders?.users?.name || 'N/A'}</td>
                    <td className="px-6 py-3">{item.product_name}</td>
                    <td className="px-6 py-3 font-mono text-xs">{item.voicex_id}</td>
                    <td className="px-6 py-3">{item.quantity}</td>
                    <td className="px-6 py-3">${(item.unit_price_cents / 100).toFixed(2)}</td>
                    <td className="px-6 py-3">${((item.unit_price_cents * item.quantity) / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-500">
                  <th className="px-6 py-3 font-medium">Return Date</th>
                  <th className="px-6 py-3 font-medium">Return #</th>
                  <th className="px-6 py-3 font-medium">Order #</th>
                  <th className="px-6 py-3 font-medium">Customer</th>
                  <th className="px-6 py-3 font-medium">Product</th>
                  <th className="px-6 py-3 font-medium">VoiceX ID</th>
                  <th className="px-6 py-3 font-medium">Qty</th>
                  <th className="px-6 py-3 font-medium">Item Subtotal</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item: any, idx: number) => (
                  <tr key={idx} className="border-b">
                    <td className="px-6 py-3 text-gray-500">{new Date(item.order_returns?.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-3">{item.order_returns?.id}</td>
                    <td className="px-6 py-3">{item.order_returns?.order_id}</td>
                    <td className="px-6 py-3">{item.order_returns?.users?.name || 'N/A'}</td>
                    <td className="px-6 py-3">{item.product_name}</td>
                    <td className="px-6 py-3 font-mono text-xs">{item.voicex_id}</td>
                    <td className="px-6 py-3">{item.quantity}</td>
                    <td className="px-6 py-3">${((item.unit_price_cents * item.quantity) / 100).toFixed(2)}</td>
                    <td className="px-6 py-3">{item.order_returns?.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
