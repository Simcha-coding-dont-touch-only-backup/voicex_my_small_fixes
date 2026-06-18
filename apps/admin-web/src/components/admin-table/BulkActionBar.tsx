import type { ReactNode } from 'react';

export type BulkAction = {
  id: string;
  label: (count: number) => string;
  icon?: ReactNode;
  variant?: 'danger' | 'default';
  disabled?: boolean;
  onRun: () => void;
};

export function BulkActionBar({
  selectedCount,
  actions,
}: {
  selectedCount: number;
  actions: BulkAction[];
}) {
  if (selectedCount <= 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => {
        const isDanger = action.variant === 'danger';
        return (
          <button
            key={action.id}
            type="button"
            onClick={action.onRun}
            disabled={action.disabled}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              isDanger
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {action.icon}
            {action.label(selectedCount)}
          </button>
        );
      })}
    </div>
  );
}
