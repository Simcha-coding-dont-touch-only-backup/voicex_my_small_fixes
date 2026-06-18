import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import { Save, RefreshCw, Pause } from 'lucide-react';
import { SETTING_KEYS, US_STATES, RAINFOREST_SYNC_INTERVAL_OPTIONS, type SyncJobState } from '@voicex/shared';

interface AppSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
}

const LABELS: Record<string, string> = {
  [SETTING_KEYS.DEFAULT_MARKUP_PERCENT]: 'Default Markup %',
  [SETTING_KEYS.MAX_CART_ITEMS]: 'Max Cart Items',
  [SETTING_KEYS.CALL_TIMEOUT_SECONDS]: 'Call Timeout (seconds)',
  [SETTING_KEYS.MAX_PIN_RETRIES]: 'Max PIN Retries',
  [SETTING_KEYS.ACTIVE_FULFILLMENT_PROVIDER]: 'Active Fulfillment Provider',
  [SETTING_KEYS.AMAZON_ASSOCIATE_TAG]: 'Amazon Associate Tag',
  [SETTING_KEYS.MANUAL_DEFAULT_TAX_PERCENT]: 'Manual Default Tax',
  [SETTING_KEYS.MANUAL_FREE_SHIPPING_CUTOFF]: 'Manual Free Shipping Cut Off',
  [SETTING_KEYS.MANUAL_SHIPPING_FEE]: 'Manual Shipping Fee',
  [SETTING_KEYS.RAINFOREST_AUTO_SYNC_ENABLED]: 'RainForest Auto Price Sync',
  [SETTING_KEYS.RAINFOREST_SYNC_INTERVAL_HOURS]: 'Sync Interval',
  [SETTING_KEYS.RAINFOREST_CHECKOUT_REVALIDATION_ENABLED]: 'RainForest Checkout Revalidation',
};

const RAINFOREST_SETTING_KEYS: string[] = [
  SETTING_KEYS.RAINFOREST_AUTO_SYNC_ENABLED,
  SETTING_KEYS.RAINFOREST_SYNC_INTERVAL_HOURS,
  SETTING_KEYS.RAINFOREST_CHECKOUT_REVALIDATION_ENABLED,
];

function intervalLabel(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

const MANUAL_STATE_TAX_KEY = SETTING_KEYS.MANUAL_STATE_TAX_RATES;

function parseStateTaxRates(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, rate]) => rate != null && String(rate).trim() !== '')
        .map(([state, rate]) => [state.toUpperCase(), String(rate)])
    );
  } catch {
    return {};
  }
}

function serializeStateTaxRates(rates: Record<string, string>) {
  const cleaned: Record<string, string> = {};
  for (const state of US_STATES) {
    const value = rates[state.code]?.trim();
    if (value) cleaned[state.code] = value;
  }
  return JSON.stringify(cleaned);
}

function percentPlaceholder(value: string) {
  const clean = value.trim() || '0';
  return `${clean.replace(/%$/, '')}%`;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [stateTaxEdits, setStateTaxEdits] = useState<Record<string, string>>({});
  const [stateTaxSavedValue, setStateTaxSavedValue] = useState('{}');
  const [showStateTax, setShowStateTax] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [syncJob, setSyncJob] = useState<SyncJobState | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSettings = async () => {
    const res = await apiGet<any>('/settings');
    const rows = res.data || [];
    setSettings(rows);

    const stateTaxSetting = rows.find((s: AppSetting) => s.key === MANUAL_STATE_TAX_KEY);
    const stateTaxValue = stateTaxSetting?.value || '{}';
    setStateTaxSavedValue(stateTaxValue);
    setStateTaxEdits(parseStateTaxRates(stateTaxValue));
  };

  const refreshSyncStatus = async () => {
    try {
      const res = await apiGet<{ data: SyncJobState }>('/catalog/sync/status');
      setSyncJob(res.data);
      return res.data;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    loadSettings().catch((err) => setError(err?.message || 'Failed to load settings'));
    refreshSyncStatus();
  }, []);

  // Poll while a sync is running/paused so the status bar stays live and
  // continues even if the admin navigates back to this page.
  useEffect(() => {
    const running = syncJob?.status === 'running';
    if (running && !pollRef.current) {
      pollRef.current = setInterval(refreshSyncStatus, 2000);
    } else if (!running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [syncJob?.status]);

  const handleSyncNow = async () => {
    setSyncBusy(true);
    setError('');
    try {
      const res = await apiPost<{ data: SyncJobState }>('/catalog/sync/start', {});
      setSyncJob(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to start sync');
    } finally {
      setSyncBusy(false);
    }
  };

  const handlePauseSync = async () => {
    setSyncBusy(true);
    try {
      const res = await apiPost<{ data: SyncJobState }>('/catalog/sync/pause', {});
      setSyncJob(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to pause sync');
    } finally {
      setSyncBusy(false);
    }
  };

  const handleSave = async (key: string) => {
    setSaving(key);
    setError('');
    try {
      await apiPatch(`/settings/${key}`, { value: edits[key] });
      if (key === SETTING_KEYS.DEFAULT_MARKUP_PERCENT) {
        window.dispatchEvent(new CustomEvent('voicex:alerts-count-refresh'));
      }
      const res = await apiGet<any>('/settings');
      setSettings(res.data || []);
      const newEdits = { ...edits };
      delete newEdits[key];
      setEdits(newEdits);
    } catch (err: any) {
      setError(err?.message || 'Failed to save setting');
    } finally {
      setSaving('');
    }
  };

  const handleSaveStateTaxes = async () => {
    setSaving(MANUAL_STATE_TAX_KEY);
    setError('');
    try {
      const value = serializeStateTaxRates(stateTaxEdits);
      await apiPatch(`/settings/${MANUAL_STATE_TAX_KEY}`, { value });
      await loadSettings();
    } catch (err: any) {
      setError(err?.message || 'Failed to save state tax overrides');
    } finally {
      setSaving('');
    }
  };

  const renderSettingInput = (s: AppSetting) => {
    const value = edits[s.key] !== undefined ? edits[s.key] : s.value;

    if (s.key === SETTING_KEYS.ACTIVE_FULFILLMENT_PROVIDER) {
      return (
        <select
          value={value}
          onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
          className="w-32 rounded border px-3 py-1.5 text-sm"
        >
          <option value="rye">Rye</option>
          <option value="manual">Manual</option>
        </select>
      );
    }

    if (
      s.key === SETTING_KEYS.RAINFOREST_AUTO_SYNC_ENABLED ||
      s.key === SETTING_KEYS.RAINFOREST_CHECKOUT_REVALIDATION_ENABLED
    ) {
      return (
        <select
          value={value === 'true' ? 'true' : 'false'}
          onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
          className="w-28 rounded border px-3 py-1.5 text-sm"
        >
          <option value="false">Off</option>
          <option value="true">On</option>
        </select>
      );
    }

    if (s.key === SETTING_KEYS.RAINFOREST_SYNC_INTERVAL_HOURS) {
      return (
        <select
          value={value}
          onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
          className="w-32 rounded border px-3 py-1.5 text-sm"
        >
          {RAINFOREST_SYNC_INTERVAL_OPTIONS.map((h) => (
            <option key={h} value={String(h)}>
              {intervalLabel(h)}
            </option>
          ))}
        </select>
      );
    }

    if (s.key === SETTING_KEYS.MANUAL_DEFAULT_TAX_PERCENT || s.key === SETTING_KEYS.DEFAULT_MARKUP_PERCENT) {
      return (
        <div className="flex items-center rounded border bg-white">
          <input
            value={value}
            inputMode="decimal"
            onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
            className="w-28 rounded-l px-3 py-1.5 text-right text-sm outline-none"
          />
          <span className="border-l px-2 text-sm text-gray-400">%</span>
        </div>
      );
    }

    if (s.key === SETTING_KEYS.MANUAL_FREE_SHIPPING_CUTOFF || s.key === SETTING_KEYS.MANUAL_SHIPPING_FEE) {
      return (
        <div className="flex items-center rounded border bg-white">
          <span className="border-r px-2 text-sm text-gray-400">$</span>
          <input
            value={value}
            inputMode="decimal"
            onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
            className="w-28 rounded-r px-3 py-1.5 text-right text-sm outline-none"
          />
        </div>
      );
    }

    return (
      <input
        value={value}
        onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
        className="w-32 rounded border px-3 py-1.5 text-right text-sm"
      />
    );
  };

  const defaultTax = edits[SETTING_KEYS.MANUAL_DEFAULT_TAX_PERCENT] !== undefined
    ? edits[SETTING_KEYS.MANUAL_DEFAULT_TAX_PERCENT]
    : settings.find((s) => s.key === SETTING_KEYS.MANUAL_DEFAULT_TAX_PERCENT)?.value || '0';
  const serializedStateTaxEdits = serializeStateTaxRates(stateTaxEdits);
  const stateTaxesChanged = serializedStateTaxEdits !== stateTaxSavedValue;
  const visibleSettings = settings.filter(
    (s) => s.key !== MANUAL_STATE_TAX_KEY && !RAINFOREST_SETTING_KEYS.includes(s.key),
  );

  const rainforestSettings = settings.filter((s) => RAINFOREST_SETTING_KEYS.includes(s.key));
  const autoSyncSetting = rainforestSettings.find(
    (s) => s.key === SETTING_KEYS.RAINFOREST_AUTO_SYNC_ENABLED,
  );
  const autoSyncOn =
    (edits[SETTING_KEYS.RAINFOREST_AUTO_SYNC_ENABLED] ?? autoSyncSetting?.value) === 'true';

  const renderRainforestRow = (s: AppSetting) => (
    <div key={s.key} className="flex items-center justify-between gap-4 border-b px-6 py-4 last:border-0">
      <div>
        <p className="font-medium text-gray-800">{LABELS[s.key] || s.key}</p>
        {s.description && <p className="text-xs text-gray-400">{s.description}</p>}
      </div>
      <div className="flex items-center gap-3">
        {renderSettingInput(s)}
        {edits[s.key] !== undefined && edits[s.key] !== s.value && (
          <button
            onClick={() => handleSave(s.key)}
            disabled={saving === s.key}
            className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save size={14} />
            {saving === s.key ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
    </div>
  );

  const syncRunning = syncJob?.status === 'running';
  const syncPaused = syncJob?.status === 'paused';
  const syncPct =
    syncJob && syncJob.total > 0 ? Math.round((syncJob.processed / syncJob.total) * 100) : 0;

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">Settings</h2>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm">
        {visibleSettings.map((s) => (
          <div key={s.key} className="border-b px-6 py-4 last:border-0">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-gray-800">{LABELS[s.key] || s.key}</p>
                {s.description && <p className="text-xs text-gray-400">{s.description}</p>}
              </div>
              <div className="flex items-center gap-3">
                {renderSettingInput(s)}
                {edits[s.key] !== undefined && edits[s.key] !== s.value && (
                  <button
                    onClick={() => handleSave(s.key)}
                    disabled={saving === s.key}
                    className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Save size={14} />
                    {saving === s.key ? 'Saving...' : 'Save'}
                  </button>
                )}
              </div>
            </div>

            {s.key === SETTING_KEYS.MANUAL_DEFAULT_TAX_PERCENT && (
              <div className="mt-4 rounded-lg border bg-gray-50">
                <button
                  type="button"
                  onClick={() => setShowStateTax((open) => !open)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  <span>Customize by State</span>
                  <span className="text-xs text-gray-400">{showStateTax ? 'Hide' : 'Show'}</span>
                </button>

                {showStateTax && (
                  <div className="border-t px-4 py-4">
                    <p className="mb-4 text-xs text-gray-500">
                      Leave a state blank to use the default tax rate. Customers hear the tax amount, not the percentage.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {US_STATES.map((state) => (
                        <label key={state.code} className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 text-gray-700">
                            {state.name} <span className="text-xs text-gray-400">{state.code}</span>
                          </span>
                          <div className="flex shrink-0 items-center rounded border bg-white">
                            <input
                              value={stateTaxEdits[state.code] || ''}
                              placeholder={percentPlaceholder(defaultTax)}
                              inputMode="decimal"
                              onChange={(e) => setStateTaxEdits((prev) => ({
                                ...prev,
                                [state.code]: e.target.value,
                              }))}
                              className="w-20 rounded-l px-2 py-1.5 text-right text-sm outline-none placeholder:text-gray-300"
                            />
                            <span className="border-l px-2 text-sm text-gray-400">%</span>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={handleSaveStateTaxes}
                        disabled={!stateTaxesChanged || saving === MANUAL_STATE_TAX_KEY}
                        className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Save size={14} />
                        {saving === MANUAL_STATE_TAX_KEY ? 'Saving...' : 'Save State Rates'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {settings.length === 0 && (
          <div className="px-6 py-10 text-center text-sm text-gray-400">No settings found.</div>
        )}
      </div>

      {rainforestSettings.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-lg font-semibold text-gray-800">RainForest Price Sync</h3>
          <div className="rounded-xl bg-white shadow-sm">
            {autoSyncSetting && renderRainforestRow(autoSyncSetting)}

            {autoSyncOn &&
              rainforestSettings
                .filter((s) => s.key === SETTING_KEYS.RAINFOREST_SYNC_INTERVAL_HOURS)
                .map(renderRainforestRow)}

            {rainforestSettings
              .filter((s) => s.key === SETTING_KEYS.RAINFOREST_CHECKOUT_REVALIDATION_ENABLED)
              .map(renderRainforestRow)}

            <div className="px-6 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSyncNow}
                  disabled={syncBusy || syncRunning}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <RefreshCw size={16} className={syncRunning ? 'animate-spin' : ''} />
                  {syncRunning ? 'Syncing...' : 'Sync Now'}
                </button>
                {syncRunning && (
                  <button
                    type="button"
                    onClick={handlePauseSync}
                    disabled={syncBusy || (syncJob?.pauseRequested ?? false)}
                    className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Pause size={16} />
                    {syncJob?.pauseRequested ? 'Pausing...' : 'Pause Sync'}
                  </button>
                )}
              </div>

              {syncJob && (syncRunning || syncPaused) && (
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {syncPaused ? 'Paused' : 'Syncing'} {syncJob.processed} / {syncJob.total}
                      {syncJob.changed > 0 ? ` (${syncJob.changed} changed)` : ''}
                      {syncJob.currentProductName ? ` — ${syncJob.currentProductName}` : ''}
                    </span>
                    <span>{syncPct}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full transition-all ${syncPaused ? 'bg-amber-400' : 'bg-indigo-500'}`}
                      style={{ width: `${syncPct}%` }}
                    />
                  </div>
                  {syncJob.lastError && (
                    <p className="mt-2 text-xs text-amber-600">Last issue: {syncJob.lastError}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
