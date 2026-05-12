import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Loader2, Trash2, Upload, X } from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import {
  IMPORT_FIELDS,
  NOT_MAPPED,
  buildImportRowFromMapping,
  isAcceptedSpreadsheetFile,
  parseSpreadsheetFile,
  type CategoryLite,
  type ImportFieldKey,
  type ImportFieldSelection,
  type ImportRowResult,
  type MappingEntry,
  type ParsedSpreadsheet,
} from '../lib/import-mapping';

interface ImportTemplate {
  id: string;
  name: string;
  description: string | null;
  mapping: MappingEntry[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ImportProductsFlowProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  categories: CategoryLite[];
}

type FlowPhase = 'picker' | 'mapping' | 'importing' | 'summary';

const ROW_IMPORT_CONCURRENCY = 4;

const ACCEPT_ATTR = '.xlsx,.xls,.csv';

function FilePickerView({
  onFile,
  rejectionError,
  onCancel,
}: {
  onFile: (file: File) => void;
  rejectionError: string | null;
  onCancel: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onFile(files[0]);
  };

  return (
    <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Import Products from Spreadsheet</h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50'
        }`}
      >
        <FileSpreadsheet size={36} className="mb-3 text-indigo-500" aria-hidden />
        <p className="text-sm font-medium text-gray-700">Drag &amp; drop a spreadsheet here</p>
        <p className="mt-1 text-xs text-gray-500">Accepted formats: .xlsx, .xls, .csv</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          <Upload size={14} /> Browse Files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {rejectionError && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {rejectionError}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border px-4 py-2 text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SaveTemplateModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, description: string | null) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setError('');
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await onSave(name.trim(), description.trim() || null);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save template.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/40">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Save Mapping Template</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-600">Name</label>
                <input
                  ref={nameRef}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  placeholder="e.g. Supplier ABC default mapping"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Description <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                />
              </div>
            </div>
            {error && (
              <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteTemplateModal({
  template,
  onClose,
  onConfirm,
}: {
  template: ImportTemplate | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (template) {
      setDeleting(false);
      setError('');
    }
  }, [template]);

  if (!template) return null;

  const handleConfirm = async () => {
    setDeleting(true);
    setError('');
    try {
      await onConfirm();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete template.');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/40">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Delete Mapping Template</h3>
          </div>
          <p className="mb-6 text-sm text-gray-600">
            This will permanently delete the template{' '}
            <span className="font-medium text-gray-900">"{template.name}"</span>. This action cannot be
            undone.
          </p>
          {error && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="rounded border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={deleting}
              className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ImportProgressState {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  results: ImportRowResult[];
}

function makeInitialProgress(total: number): ImportProgressState {
  return { total, completed: 0, succeeded: 0, failed: 0, results: [] };
}

export function ImportProductsFlow({
  open,
  onClose,
  onImported,
  categories,
}: ImportProductsFlowProps) {
  const [phase, setPhase] = useState<FlowPhase>('picker');
  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const [selections, setSelections] = useState<ImportFieldSelection[]>([]);
  const [mappingError, setMappingError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<ImportTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ImportTemplate | null>(null);

  const [progress, setProgress] = useState<ImportProgressState>(makeInitialProgress(0));
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const reset = useCallback(() => {
    setPhase('picker');
    setParsed(null);
    setFileName('');
    setPickerError(null);
    setParsing(false);
    setSelections([]);
    setMappingError(null);
    setShowSaveTemplate(false);
    setConfirmDelete(null);
    setProgress(makeInitialProgress(0));
    cancelRef.current = { cancelled: false };
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const r = await apiGet<{ data: ImportTemplate[] }>('/catalog/import-templates');
      setTemplates(r.data || []);
    } catch (err: any) {
      setTemplatesError(err?.message || 'Failed to load templates.');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadTemplates();
  }, [open, loadTemplates]);

  const handleFile = async (file: File) => {
    setPickerError(null);
    if (!isAcceptedSpreadsheetFile(file)) {
      setPickerError(
        `"${file.name}" is not a supported file type. Please upload an .xlsx, .xls, or .csv file.`,
      );
      return;
    }
    setParsing(true);
    try {
      const result = await parseSpreadsheetFile(file);
      setParsed(result);
      setFileName(file.name);
      setSelections(result.headers.map(() => NOT_MAPPED));
      setMappingError(null);
      setPhase('mapping');
    } catch (err: any) {
      setPickerError(err?.message || 'Failed to read the spreadsheet.');
    } finally {
      setParsing(false);
    }
  };

  const usedFields = useMemo(() => {
    const set = new Set<ImportFieldKey>();
    for (const s of selections) {
      if (s !== NOT_MAPPED) set.add(s);
    }
    return set;
  }, [selections]);

  const setSelectionAt = (index: number, value: ImportFieldSelection) => {
    setSelections((prev) => prev.map((s, i) => (i === index ? value : s)));
    setMappingError(null);
  };

  const buildMappingEntries = (): MappingEntry[] => {
    if (!parsed) return [];
    const entries: MappingEntry[] = [];
    selections.forEach((sel, idx) => {
      if (sel === NOT_MAPPED) return;
      entries.push({
        column_index: idx,
        column_label: parsed.headers[idx] ?? `Column ${idx + 1}`,
        field: sel,
      });
    });
    return entries;
  };

  const applyTemplate = (template: ImportTemplate) => {
    if (!parsed) return;
    const next: ImportFieldSelection[] = parsed.headers.map(() => NOT_MAPPED);
    const headerLookup = new Map<string, number>();
    parsed.headers.forEach((h, i) => headerLookup.set(h.trim().toLowerCase(), i));
    const claimedFields = new Set<ImportFieldKey>();

    for (const entry of template.mapping) {
      // Prefer matching by header label (file may have different column order),
      // fall back to original column_index.
      const byLabel = headerLookup.get(entry.column_label.trim().toLowerCase());
      let targetIdx: number | undefined =
        byLabel !== undefined && byLabel < next.length ? byLabel : undefined;
      if (targetIdx === undefined && entry.column_index < next.length) {
        targetIdx = entry.column_index;
      }
      if (targetIdx === undefined) continue;
      // Don't overwrite a slot already mapped (label match took precedence).
      if (next[targetIdx] !== NOT_MAPPED) continue;
      // Each field can only be used once.
      if (claimedFields.has(entry.field)) continue;
      next[targetIdx] = entry.field;
      claimedFields.add(entry.field);
    }
    setSelections(next);
    setMappingError(null);
  };

  const handleSaveTemplate = async (name: string, description: string | null) => {
    const mapping = buildMappingEntries();
    if (mapping.length === 0) {
      throw new Error('Map at least one column before saving a template.');
    }
    await apiPost('/catalog/import-templates', { name, description, mapping });
    await loadTemplates();
  };

  const handleDeleteTemplate = async () => {
    if (!confirmDelete) return;
    await apiDelete(`/catalog/import-templates/${confirmDelete.id}`);
    setConfirmDelete(null);
    await loadTemplates();
  };

  const runImport = async () => {
    if (!parsed) return;
    if (!usedFields.has('asin')) {
      setMappingError('It is mandatory to map at least one column as the ASIN data.');
      return;
    }
    setMappingError(null);

    const mapping = buildMappingEntries();

    // Pre-build all per-row payloads. Local validation failures (missing
    // ASIN, bad price, unknown category) are recorded as failed results
    // immediately without an HTTP call.
    type WorkItem =
      | { kind: 'local-fail'; result: ImportRowResult }
      | {
          kind: 'remote';
          payload: ReturnType<typeof buildImportRowFromMapping>['payload'];
          rowNumber: number;
        };

    const work: WorkItem[] = parsed.rows.map((row, idx) => {
      const built = buildImportRowFromMapping(idx, row, mapping, categories);
      if (built.error || !built.payload) {
        return {
          kind: 'local-fail',
          result: {
            success: false,
            status: 'failed',
            row_number: built.row_number,
            asin: '',
            error: built.error || 'Row could not be processed.',
          },
        };
      }
      return { kind: 'remote', payload: built.payload, rowNumber: built.row_number };
    });

    cancelRef.current = { cancelled: false };
    setProgress(makeInitialProgress(work.length));
    setPhase('importing');

    const recordResult = (result: ImportRowResult) => {
      setProgress((prev) => ({
        total: prev.total,
        completed: prev.completed + 1,
        succeeded: prev.succeeded + (result.success ? 1 : 0),
        failed: prev.failed + (result.success ? 0 : 1),
        results: [...prev.results, result],
      }));
    };

    let cursor = 0;
    const runOne = async () => {
      for (;;) {
        if (cancelRef.current.cancelled) return;
        const idx = cursor++;
        if (idx >= work.length) return;
        const item = work[idx];
        if (item.kind === 'local-fail') {
          recordResult(item.result);
          continue;
        }
        try {
          const r = await apiPost<ImportRowResult>('/catalog/products/import-row', item.payload);
          recordResult(r);
        } catch (err: any) {
          recordResult({
            success: false,
            status: 'failed',
            row_number: item.rowNumber,
            asin: item.payload?.asin || '',
            error: err?.message || 'Import request failed.',
          });
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(ROW_IMPORT_CONCURRENCY, work.length) },
      () => runOne(),
    );
    await Promise.all(workers);

    setPhase('summary');
  };

  const stopImport = () => {
    cancelRef.current.cancelled = true;
  };

  const handleCloseFromSummary = () => {
    if (progress.succeeded > 0) onImported();
    onClose();
  };

  const handleCancelFlow = () => {
    if (phase === 'importing') {
      stopImport();
      return;
    }
    onClose();
  };

  const handleChangeFile = () => {
    setParsed(null);
    setFileName('');
    setSelections([]);
    setMappingError(null);
    setPhase('picker');
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40">
        <div className="flex min-h-full items-center justify-center p-4">
          {phase === 'picker' && (
            <FilePickerView
              onFile={(f) => void handleFile(f)}
              rejectionError={parsing ? null : pickerError}
              onCancel={onClose}
            />
          )}

          {(phase === 'mapping' || phase === 'importing' || phase === 'summary') && parsed && (
            <div className="my-8 w-full max-w-5xl rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {phase === 'summary' ? 'Import Summary' : 'Map Spreadsheet Columns'}
                </h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  <span className="font-mono">{fileName}</span>
                  {' · '}
                  {parsed.rows.length} data row{parsed.rows.length === 1 ? '' : 's'} ·{' '}
                  {parsed.headers.length} column{parsed.headers.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {phase === 'mapping' && (
                  <button
                    type="button"
                    onClick={handleChangeFile}
                    className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
                  >
                    Change file
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {phase === 'mapping' && (
              <>
                <section className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h4 className="mb-2 text-sm font-semibold text-gray-700">
                    Saved mapping templates
                  </h4>
                  {templatesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Loader2 size={14} className="animate-spin" /> Loading templates...
                    </div>
                  ) : templatesError ? (
                    <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {templatesError}
                    </div>
                  ) : templates.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No templates saved yet. After mapping, click "Save Template" below to reuse
                      this mapping next time.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {templates.map((t) => (
                        <li
                          key={t.id}
                          className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-white px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-gray-800">
                              {t.name}
                            </div>
                            {t.description && (
                              <div className="truncate text-xs text-gray-500">{t.description}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => applyTemplate(t)}
                              className="rounded border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                            >
                              Apply Now
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(t)}
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                              title="Delete template"
                              aria-label={`Delete template ${t.name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="mb-6">
                  <h4 className="mb-2 text-sm font-semibold text-gray-700">Column mapping</h4>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                          <th className="px-3 py-2 font-medium">Spreadsheet Column</th>
                          <th className="px-3 py-2 font-medium">Sample Data</th>
                          <th className="px-3 py-2 font-medium">Map To Field</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.headers.map((header, idx) => {
                          const sample = parsed.sample
                            .map((r) => r[idx])
                            .filter((v) => v != null && String(v).trim() !== '');
                          const current = selections[idx] ?? NOT_MAPPED;
                          return (
                            <tr key={idx} className="border-b last:border-b-0">
                              <td className="px-3 py-2 align-top font-medium text-gray-800">
                                {header}
                              </td>
                              <td className="px-3 py-2 align-top text-xs text-gray-600">
                                {sample.length === 0 ? (
                                  <span className="italic text-gray-400">empty</span>
                                ) : (
                                  <div className="space-y-0.5">
                                    {sample.map((v, i) => (
                                      <div key={i} className="truncate" title={String(v)}>
                                        {String(v)}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top">
                                <select
                                  value={current}
                                  onChange={(e) =>
                                    setSelectionAt(idx, e.target.value as ImportFieldSelection)
                                  }
                                  className="w-56 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                >
                                  <option value={NOT_MAPPED}>Not Mapped</option>
                                  {IMPORT_FIELDS.map((f) => {
                                    const takenElsewhere =
                                      f.key !== current && usedFields.has(f.key);
                                    return (
                                      <option
                                        key={f.key}
                                        value={f.key}
                                        disabled={takenElsewhere}
                                      >
                                        {f.label}
                                        {takenElsewhere ? ' (already mapped)' : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                {mappingError && (
                  <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {mappingError}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSaveTemplate(true)}
                    className="rounded border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
                  >
                    Save Template
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleCancelFlow}
                      className="rounded border px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void runImport()}
                      className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
                    >
                      Import Products
                    </button>
                  </div>
                </div>
              </>
            )}

            {phase === 'importing' && (
              <ImportProgressView
                progress={progress}
                cancelled={cancelRef.current.cancelled}
                onStop={stopImport}
              />
            )}

            {phase === 'summary' && (
              <ImportSummaryView progress={progress} onClose={handleCloseFromSummary} />
            )}
          </div>
        )}
        </div>
      </div>

      <SaveTemplateModal
        open={showSaveTemplate}
        onClose={() => setShowSaveTemplate(false)}
        onSave={handleSaveTemplate}
      />

      <ConfirmDeleteTemplateModal
        template={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDeleteTemplate}
      />
    </>
  );
}

function ImportProgressView({
  progress,
  cancelled,
  onStop,
}: {
  progress: ImportProgressState;
  cancelled: boolean;
  onStop: () => void;
}) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm text-gray-700">
        <span>
          Importing {progress.completed} of {progress.total}
          {cancelled ? ' (stopping...)' : ''}
        </span>
        <span className="font-mono text-xs text-gray-500">
          <span className="text-green-700">{progress.succeeded} succeeded</span>
          {' · '}
          <span className="text-red-700">{progress.failed} failed</span>
        </span>
      </div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-gray-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.completed}
      >
        <div
          className="h-full bg-indigo-600 transition-all duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onStop}
          disabled={cancelled}
          className="rounded border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {cancelled ? 'Stopping...' : 'Stop Import'}
        </button>
      </div>
    </div>
  );
}

function ImportSummaryView({
  progress,
  onClose,
}: {
  progress: ImportProgressState;
  onClose: () => void;
}) {
  const failures = progress.results.filter((r) => !r.success);
  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Total Rows</div>
          <div className="mt-1 text-2xl font-semibold text-gray-800">{progress.total}</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <div className="text-xs uppercase tracking-wide text-green-700">Succeeded</div>
          <div className="mt-1 text-2xl font-semibold text-green-700">{progress.succeeded}</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="text-xs uppercase tracking-wide text-red-700">Failed</div>
          <div className="mt-1 text-2xl font-semibold text-red-700">{progress.failed}</div>
        </div>
      </div>

      {failures.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-sm font-semibold text-gray-700">Failed rows</h4>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-red-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-red-50 text-left text-xs uppercase tracking-wide text-red-700">
                  <th className="w-20 px-3 py-2 font-medium">Row</th>
                  <th className="w-32 px-3 py-2 font-medium">ASIN</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="px-3 py-2 align-top font-mono text-xs text-gray-600">
                      {f.row_number}
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-xs text-gray-600">
                      {f.asin || '—'}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-red-700">
                      {f.success ? '' : f.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          Close
        </button>
      </div>
    </div>
  );
}
