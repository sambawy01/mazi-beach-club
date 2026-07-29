// Tiny dependency-free CSV export. Values are escaped per RFC 4180 and the file
// is offered as a download via a transient object URL. Used by the admin tabs
// (orders, reservations, audit, contacts) so staff can pull data into Excel.

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Guard against CSV formula injection in spreadsheet apps.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export type CsvColumn<T> = { header: string; value: (row: T) => unknown };

export function exportToCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const head = columns.map(c => escapeCell(c.header)).join(',');
  const body = rows.map(r => columns.map(c => escapeCell(c.value(r))).join(',')).join('\r\n');
  const csv = '﻿' + head + '\r\n' + body; // BOM so Excel reads UTF-8
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Convenience: stamp a filename with a date the caller passes in (avoids
// importing Date here so callers control the timezone/label).
export function stampedName(base: string, dateLabel: string): string {
  return `${base}-${dateLabel}.csv`;
}
