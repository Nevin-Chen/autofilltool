import type { SubmissionRecord } from '@/profile/schema';

const COLUMNS = [
  'timestamp',
  'company',
  'role',
  'source',
  'status',
  'note',
  'jobUrl',
] as const satisfies ReadonlyArray<keyof SubmissionRecord>;

export function toCsv(records: ReadonlyArray<SubmissionRecord>): string {
  const header = COLUMNS.join(',');
  const rows = records.map((r) =>
    COLUMNS.map((c) => escapeCell(String(r[c] ?? ''))).join(','),
  );
  return [header, ...rows].join('\r\n');
}

function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvFilename(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `autofilltool-history-${date}.csv`;
}
