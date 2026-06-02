import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface FilterSingleSelectOption {
  value: string;
  label: string;
}

interface FilterSingleSelectProps {
  options: FilterSingleSelectOption[];
  value: string;
  onChange: (value: string) => void;
  leadingIcon?: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function FilterSingleSelect({
  options,
  value,
  onChange,
  leadingIcon,
  className = '',
  'aria-label': ariaLabel,
}: FilterSingleSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border bg-white py-2 pl-3 pr-2 text-left text-sm hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        {leadingIcon}
        <span className="min-w-0 flex-1 truncate text-gray-800">{selected?.label}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {options.map((o) => {
            const checked = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={checked}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50 ${
                    checked ? 'bg-indigo-50/60 text-indigo-700' : 'text-gray-700'
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {checked && <Check size={14} className="shrink-0 text-indigo-600" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
