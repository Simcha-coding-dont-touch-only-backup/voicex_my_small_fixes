import type { DeliveryRunStatus } from '@voicex/shared';

export function money(cents: number | null | undefined): string {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const DISPLAY_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  temp_paused: 'Temporarily Paused',
  perm_paused: 'Permanently Paused',
  failed: 'Failed',
};

const DISPLAY_STATUS_CLASSES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  temp_paused: 'bg-amber-100 text-amber-700',
  perm_paused: 'bg-gray-200 text-gray-600',
  failed: 'bg-red-100 text-red-700',
};

export function deliveryStatusLabel(status: string): string {
  return DISPLAY_STATUS_LABELS[status] || status;
}

export function DeliveryStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${DISPLAY_STATUS_CLASSES[status] || 'bg-gray-100 text-gray-600'}`}>
      {deliveryStatusLabel(status)}
    </span>
  );
}

const RUN_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-700',
  issue: 'bg-amber-100 text-amber-700',
  locked: 'bg-indigo-100 text-indigo-700',
  processing: 'bg-indigo-100 text-indigo-700',
  processed: 'bg-green-100 text-green-700',
  partial: 'bg-teal-100 text-teal-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-200 text-gray-600',
};

export function RunStatusBadge({ status }: { status: DeliveryRunStatus | string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${RUN_STATUS_CLASSES[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

export function ModalShell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`flex max-h-[90vh] w-full flex-col rounded-xl bg-white shadow-xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
