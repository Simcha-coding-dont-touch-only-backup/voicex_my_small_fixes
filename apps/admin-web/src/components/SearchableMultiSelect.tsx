import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface SearchableMultiSelectOption {
  value: string;
  label: string;
}

interface SearchableMultiSelectProps {
  options: SearchableMultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
}

export function SearchableMultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  emptyText = 'No results',
  className = '',
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      // Defer focus until after the input is rendered
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const selectedOptions = useMemo(
    () => options.filter((o) => value.includes(o.value)),
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (optValue: string) => {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  };

  const removeOne = (optValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== optValue));
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded border bg-white px-3 py-2 text-left text-sm hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <div className="flex flex-1 flex-wrap gap-1">
          {selectedOptions.length === 0 ? (
            <span className="text-gray-400">{placeholder}</span>
          ) : (
            selectedOptions.map((o) => (
              <span
                key={o.value}
                className="inline-flex items-center gap-1 rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700"
              >
                {o.label}
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => removeOne(o.value, e)}
                  className="rounded p-0.5 hover:bg-indigo-200"
                >
                  <X size={10} />
                </span>
              </span>
            ))
          )}
        </div>
        <ChevronDown
          size={16}
          className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="relative border-b">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="w-full rounded-t-lg border-0 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-0"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400">{emptyText}</li>
            ) : (
              filteredOptions.map((o) => {
                const checked = value.includes(o.value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => toggle(o.value)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50 ${
                        checked ? 'bg-indigo-50/60 text-indigo-700' : 'text-gray-700'
                      }`}
                    >
                      <span className="truncate">{o.label}</span>
                      {checked && <Check size={14} className="text-indigo-600" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
