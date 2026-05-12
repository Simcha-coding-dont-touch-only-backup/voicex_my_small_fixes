import * as XLSX from 'xlsx';

export type ImportFieldKey =
  | 'asin'
  | 'voice_name'
  | 'voice_description'
  | 'custom_price'
  | 'local_price'
  | 'category';

export const NOT_MAPPED = 'not_mapped' as const;
export type ImportFieldSelection = ImportFieldKey | typeof NOT_MAPPED;

export interface ImportFieldOption {
  key: ImportFieldKey;
  label: string;
}

/** Order is also the order shown in the dropdown (after "Not Mapped"). */
export const IMPORT_FIELDS: readonly ImportFieldOption[] = [
  { key: 'asin', label: 'ASIN' },
  { key: 'voice_name', label: 'VoiceX Name' },
  { key: 'voice_description', label: 'VoiceX Description' },
  { key: 'custom_price', label: 'VoiceX Price' },
  { key: 'local_price', label: 'Local Store Price' },
  { key: 'category', label: 'Category' },
];

export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;
const ACCEPTED_EXT_SET = new Set<string>(ACCEPTED_EXTENSIONS);

export function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx).toLowerCase();
}

export function isAcceptedSpreadsheetFile(file: File): boolean {
  return ACCEPTED_EXT_SET.has(getFileExtension(file.name));
}

export interface ParsedSpreadsheet {
  /** Header label per column (first sheet row, falling back to "Column N"). */
  headers: string[];
  /** Up to two preview rows of stringified cell values, aligned to `headers`. */
  sample: string[][];
  /** All data rows (excluding the header), stringified per cell. */
  rows: string[][];
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value);
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('The uploaded file does not contain any sheets.');
  }
  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  if (matrix.length === 0) {
    throw new Error('The uploaded file is empty.');
  }

  const headerRow = (matrix[0] || []).map(cellToString);
  const colCount = headerRow.length;
  if (colCount === 0) {
    throw new Error('The uploaded file does not contain any columns.');
  }

  const headers: string[] = headerRow.map((value, idx) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : `Column ${idx + 1}`;
  });

  const dataRows: string[][] = matrix.slice(1).map((row) => {
    const out: string[] = [];
    for (let i = 0; i < colCount; i++) {
      out.push(cellToString(row?.[i]));
    }
    return out;
  });

  // Drop fully-empty trailing rows (xlsx can include them).
  while (dataRows.length > 0 && dataRows[dataRows.length - 1].every((c) => c.trim() === '')) {
    dataRows.pop();
  }

  if (dataRows.length === 0) {
    throw new Error('The uploaded file does not contain any data rows.');
  }

  return {
    headers,
    sample: dataRows.slice(0, 2),
    rows: dataRows,
  };
}

/** Strips `$`, commas, and whitespace; returns rounded cents or null. */
export function parsePriceToCents(raw: string): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function parseCategoryCell(raw: string): string[] {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface CategoryLite {
  id: string;
  name: string;
}

export function resolveCategoryNames(
  names: string[],
  categories: CategoryLite[],
): { ids: string[]; missing: string[] } {
  const lookup = new Map<string, string>();
  for (const c of categories) {
    lookup.set(c.name.trim().toLowerCase(), c.id);
  }
  const ids: string[] = [];
  const missing: string[] = [];
  const seenIds = new Set<string>();
  for (const name of names) {
    const id = lookup.get(name.trim().toLowerCase());
    if (!id) {
      missing.push(name);
      continue;
    }
    if (!seenIds.has(id)) {
      seenIds.add(id);
      ids.push(id);
    }
  }
  return { ids, missing };
}

export interface MappingEntry {
  /** Zero-based spreadsheet column index. */
  column_index: number;
  /** Header label, used when re-applying a saved template against a new file. */
  column_label: string;
  field: ImportFieldKey;
}

export interface ImportRowPayload {
  row_number: number;
  asin: string;
  voice_name: string | null;
  voice_description: string | null;
  custom_price_cents: number | null;
  local_price_cents: number | null;
  category_ids: string[];
}

export interface BuildRowResult {
  /** Spreadsheet row number including header (1-based, matches what users see in Excel). */
  row_number: number;
  payload?: ImportRowPayload;
  error?: string;
}

/**
 * Build a per-row import payload from a single spreadsheet data row.
 *
 * `dataRowIndex` is the zero-based index into the data rows (not counting
 * the header). The returned `row_number` is the Excel row number
 * (`dataRowIndex + 2`) so failures shown to the admin match what they see
 * in their spreadsheet.
 */
export function buildImportRowFromMapping(
  dataRowIndex: number,
  row: string[],
  mapping: MappingEntry[],
  categories: CategoryLite[],
): BuildRowResult {
  const rowNumber = dataRowIndex + 2;

  // Find the per-field mapping (each field key appears at most once).
  const byField = new Map<ImportFieldKey, MappingEntry>();
  for (const m of mapping) byField.set(m.field, m);

  const cellAt = (field: ImportFieldKey): string => {
    const m = byField.get(field);
    if (!m) return '';
    const raw = row[m.column_index];
    return raw == null ? '' : String(raw).trim();
  };

  const asinRaw = cellAt('asin');
  if (!asinRaw) {
    return { row_number: rowNumber, error: 'ASIN cell is empty.' };
  }
  const asin = asinRaw.toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    return { row_number: rowNumber, error: `"${asinRaw}" is not a valid 10-character Amazon ASIN.` };
  }

  const voiceNameRaw = cellAt('voice_name');
  const voiceDescRaw = cellAt('voice_description');

  const customPriceRaw = cellAt('custom_price');
  let customPriceCents: number | null = null;
  if (customPriceRaw) {
    customPriceCents = parsePriceToCents(customPriceRaw);
    if (customPriceCents === null) {
      return {
        row_number: rowNumber,
        error: `VoiceX Price "${customPriceRaw}" is not a valid price.`,
      };
    }
  }

  const localPriceRaw = cellAt('local_price');
  let localPriceCents: number | null = null;
  if (localPriceRaw) {
    localPriceCents = parsePriceToCents(localPriceRaw);
    if (localPriceCents === null) {
      return {
        row_number: rowNumber,
        error: `Local Store Price "${localPriceRaw}" is not a valid price.`,
      };
    }
  }

  let categoryIds: string[] = [];
  const categoryRaw = cellAt('category');
  if (categoryRaw) {
    const names = parseCategoryCell(categoryRaw);
    const { ids, missing } = resolveCategoryNames(names, categories);
    if (missing.length > 0) {
      const list = missing.map((n) => `"${n}"`).join(', ');
      return {
        row_number: rowNumber,
        error: `Category ${list} ${missing.length === 1 ? 'does' : 'do'} not exist.`,
      };
    }
    categoryIds = ids;
  }

  return {
    row_number: rowNumber,
    payload: {
      row_number: rowNumber,
      asin,
      voice_name: voiceNameRaw || null,
      voice_description: voiceDescRaw || null,
      custom_price_cents: customPriceCents,
      local_price_cents: localPriceCents,
      category_ids: categoryIds,
    },
  };
}

export type ImportRowResult =
  | {
      success: true;
      status: 'created';
      row_number: number;
      asin: string;
      product_id: string;
      voicex_id: string;
    }
  | {
      success: false;
      status: 'failed';
      row_number: number;
      asin: string;
      error: string;
    };
