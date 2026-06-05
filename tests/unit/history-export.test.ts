import { describe, expect, it } from 'vitest';
import { toCsv, csvFilename } from '@/lib/history-export';
import type { SubmissionRecord } from '@/profile/schema';

function mkRecord(overrides: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    timestamp: '2026-06-05T12:00:00.000Z',
    company: 'Google',
    role: 'Senior Software Engineer',
    source: 'greenhouse',
    status: 'submitted',
    note: '',
    jobUrl: 'https://example.com/job/1',
    ...overrides,
  };
}

describe('toCsv', () => {
  it('emits a header row + CRLF-separated data rows', () => {
    const csv = toCsv([mkRecord()]);
    const [header, row] = csv.split('\r\n');
    expect(header).toBe('timestamp,company,role,source,status,note,jobUrl');
    expect(row).toBe(
      '2026-06-05T12:00:00.000Z,Google,Senior Software Engineer,greenhouse,submitted,,https://example.com/job/1',
    );
  });

  it('quotes cells containing commas, quotes, or newlines per RFC 4180', () => {
    const csv = toCsv([
      mkRecord({
        company: 'Google, Inc.',
        role: 'Senior "Staff" Engineer',
        note: 'line one\nline two',
      }),
    ]);
    const row = csv.split('\r\n')[1]!;
    expect(row).toContain('"Google, Inc."');
    expect(row).toContain('"Senior ""Staff"" Engineer"');
    expect(row).toContain('"line one\nline two"');
  });

  it('emits just the header for an empty list', () => {
    expect(toCsv([])).toBe('timestamp,company,role,source,status,note,jobUrl');
  });
});

describe('csvFilename', () => {
  it('formats as autofilltool-history-YYYY-MM-DD.csv', () => {
    const fixed = new Date(2026, 5, 5);
    expect(csvFilename(fixed)).toBe('autofilltool-history-2026-06-05.csv');
  });
});
