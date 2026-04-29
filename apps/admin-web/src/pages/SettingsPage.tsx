import { useEffect, useState } from 'react';
import { apiGet, apiPatch } from '../lib/api';
import { Save } from 'lucide-react';

export function SettingsPage() {
  const [settings, setSettings] = useState<any[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState('');

  useEffect(() => {
    apiGet<any>('/settings').then((r) => setSettings(r.data || []));
  }, []);

  const handleSave = async (key: string) => {
    setSaving(key);
    await apiPatch(`/settings/${key}`, { value: edits[key] });
    const res = await apiGet<any>('/settings');
    setSettings(res.data || []);
    const newEdits = { ...edits };
    delete newEdits[key];
    setEdits(newEdits);
    setSaving('');
  };

  const LABELS: Record<string, string> = {
    default_markup_percent: 'Default Markup %',
    max_cart_items: 'Max Cart Items',
    call_timeout_seconds: 'Call Timeout (seconds)',
    max_pin_retries: 'Max PIN Retries',
    active_fulfillment_provider: 'Active Fulfillment Provider',
    amazon_associate_tag: 'Amazon Associate Tag',
  };

  const renderSettingInput = (s: any) => {
    const value = edits[s.key] !== undefined ? edits[s.key] : s.value;

    if (s.key === 'active_fulfillment_provider') {
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

    return (
      <input
        value={value}
        onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
        className="w-32 rounded border px-3 py-1.5 text-right text-sm"
      />
    );
  };

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-800">Settings</h2>

      <div className="rounded-xl bg-white shadow-sm">
        {settings.map((s) => (
          <div key={s.key} className="flex items-center justify-between border-b px-6 py-4 last:border-0">
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
        ))}
      </div>
    </div>
  );
}
