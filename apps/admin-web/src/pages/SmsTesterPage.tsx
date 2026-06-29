import { useState } from 'react';
import { apiPost } from '../lib/api';

interface SmsTestResult {
  id: string;
  status: string;
  to: string;
  from: string;
  text: string;
}

interface SmsTestResponse {
  success: boolean;
  data: SmsTestResult;
}

export function SmsTesterPage() {
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SmsTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (!to.trim() || !message.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiPost<SmsTestResponse>('/sms-test', {
        to: to.trim(),
        message: message.trim(),
      });
      setResult(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send SMS');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">SMS Tester</h1>
      <p className="mt-1 text-sm text-gray-500">
        Send a test SMS via Telnyx. The sender number is configured server-side
        ({' '}
        <span className="font-mono">TELNYX_SMS_FROM_NUMBER</span>
        ). Ensure your Telnyx messaging profile and number are set up in the portal.
      </p>

      <div className="mt-6 space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <div>
          <label htmlFor="to" className="block text-sm font-medium text-gray-700">
            Phone Number
          </label>
          <input
            id="to"
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="e.g. +15551234567 or 5551234567"
            className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label htmlFor="message" className="block text-sm font-medium text-gray-700">
            Message
          </label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={1600}
            placeholder="Type your test message..."
            className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-gray-400">{message.length} / 1600 characters</p>
        </div>

        <button
          onClick={handleSend}
          disabled={loading || !to.trim() || !message.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Send SMS'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">Error</p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
              SENT
            </span>
            <span className="text-sm text-gray-500">
              Status: <span className="font-mono">{result.status}</span>
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-gray-500">Message ID</dt>
              <dd className="mt-0.5 text-sm font-mono text-gray-900">{result.id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">From</dt>
              <dd className="mt-0.5 text-sm font-mono text-gray-900">{result.from}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">To</dt>
              <dd className="mt-0.5 text-sm font-mono text-gray-900">{result.to}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-gray-500">Text</dt>
              <dd className="mt-0.5 text-sm text-gray-900">{result.text}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
