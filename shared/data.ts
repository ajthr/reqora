import type { DataRow } from './automation.ts';

export function validateDataRows(value: unknown): DataRow[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Run data must be an array of up to 1000 objects.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 2 * 1024 * 1024) throw new Error('Run data exceeds the 2 MB limit.');
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length > 100) throw new Error('Each data row must be an object with up to 100 columns.');
    if (Object.keys(row).some(key => !key.trim() || key.length > 255)) throw new Error('Data column names must be non-empty and at most 255 characters.');
  }
  return value as DataRow[];
}

export function parseRunData(text: string, format: 'json' | 'csv'): DataRow[] {
  text = text.replace(/^\uFEFF/, '');
  if (!text.trim()) return [];
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error('Run data exceeds the 2 MB limit.');
  if (format === 'json') return validateDataRows(JSON.parse(text));
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false, closed = false;
  const cell = () => { row.push(value); value = ''; closed = false; };
  const record = () => { cell(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === '"') {
      if (value || closed) throw new Error('Unexpected quote in CSV data.');
      quoted = true;
    } else if (char === ',') cell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; record(); }
    else { if (closed) throw new Error('Unexpected characters after a quoted CSV value.'); value += char; }
    if (rows.length > 1001 || row.length > 100) throw new Error('Use up to 1000 data rows and 100 columns.');
  }
  if (quoted) throw new Error('Unclosed quoted CSV value.');
  if (value || row.length || closed) record();
  const headers = rows.shift()?.map(header => header.trim()) || [];
  if (!headers.length || headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be non-empty and unique.');
  return validateDataRows(rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} values; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  }));
}
