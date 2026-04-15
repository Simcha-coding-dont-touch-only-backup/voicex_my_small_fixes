import { useState } from 'react';
import { apiPost } from '../lib/api';

interface ValidationResult {
  isValid: boolean;
  action: string;
  formattedAddress: string | null;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  validationGranularity: string;
  addressComplete: boolean;
  hasSpellCorrections: boolean;
  hasReplacements: boolean;
  hasInferences: boolean;
  hasUnresolvedTokens: boolean;
  dpvConfirmation: string;
}

export function AddressTestPage() {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleValidate() {
    if (!address.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiPost<ValidationResult>('/address-test', { address: address.trim() });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Address Validation Test</h1>
      <p className="mt-1 text-sm text-gray-500">
        Test freeform address input against the Google Address Validation API.
        Type an address the way a caller would say it and see how Google parses it.
      </p>

      <div className="mt-6 rounded-lg border bg-white p-6 shadow-sm">
        <label htmlFor="address" className="block text-sm font-medium text-gray-700">
          Freeform Address
        </label>
        <div className="mt-2 flex gap-3">
          <input
            id="address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
            placeholder="e.g. 123 Main St Apt 4B, Brooklyn, New York 11201"
            className="block flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={handleValidate}
            disabled={loading || !address.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? 'Validating...' : 'Validate'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">Error</p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          <div className={`rounded-lg border p-4 ${result.isValid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                result.isValid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {result.isValid ? 'VALID' : 'INVALID'}
              </span>
              <span className="text-sm text-gray-500">
                Action: <span className="font-mono">{result.action}</span>
              </span>
            </div>
            {result.formattedAddress && (
              <p className="mt-2 text-sm text-gray-700">
                <span className="font-medium">Formatted:</span> {result.formattedAddress}
              </p>
            )}
          </div>

          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Verdict Details</h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <dt className="text-xs font-medium text-gray-500">Validation Granularity</dt>
                <dd className={`mt-0.5 text-sm font-mono ${
                  result.validationGranularity === 'PREMISE' || result.validationGranularity === 'SUB_PREMISE'
                    ? 'text-green-700' : 'text-red-700'
                }`}>{result.validationGranularity}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Address Complete</dt>
                <dd className={`mt-0.5 text-sm font-mono ${result.addressComplete ? 'text-green-700' : 'text-red-700'}`}>
                  {result.addressComplete ? 'Yes' : 'No'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Unresolved Tokens</dt>
                <dd className={`mt-0.5 text-sm font-mono ${result.hasUnresolvedTokens ? 'text-red-700' : 'text-green-700'}`}>
                  {result.hasUnresolvedTokens ? 'Yes' : 'No'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">USPS DPV Confirmation</dt>
                <dd className={`mt-0.5 text-sm font-mono ${
                  result.dpvConfirmation === 'Y' ? 'text-green-700'
                    : result.dpvConfirmation ? 'text-amber-700' : 'text-gray-400'
                }`}>{result.dpvConfirmation || '—'}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Parsed Components</h3>
            <p className="mb-3 mt-1 text-xs text-gray-500">
              These are the values that would be stored in the database.
            </p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <dt className="text-xs font-medium text-gray-500">Address Line 1</dt>
                <dd className="mt-0.5 text-sm text-gray-900 font-mono">{result.address1 || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Address Line 2 (Apt)</dt>
                <dd className="mt-0.5 text-sm text-gray-900 font-mono">{result.address2 || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">City</dt>
                <dd className="mt-0.5 text-sm text-gray-900 font-mono">{result.city || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">State</dt>
                <dd className="mt-0.5 text-sm text-gray-900 font-mono">{result.state || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">ZIP Code</dt>
                <dd className="mt-0.5 text-sm text-gray-900 font-mono">{result.zipCode || '—'}</dd>
              </div>
            </dl>
          </div>

          {(result.hasSpellCorrections || result.hasReplacements || result.hasInferences) && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h3 className="text-sm font-semibold text-blue-900">Corrections Applied</h3>
              <ul className="mt-2 space-y-1 text-sm text-blue-700">
                {result.hasSpellCorrections && <li>Spell corrections were applied</li>}
                {result.hasReplacements && <li>Component replacements were made</li>}
                {result.hasInferences && <li>Components were inferred</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
