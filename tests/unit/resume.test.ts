import { describe, expect, it } from 'vitest';
import {
  fileToResumeRecord,
  resumeRecordToFile,
  bytesToBase64,
  base64ToBytes,
} from '@/profile/resume';

describe('base64 round-trip', () => {
  it('round-trips arbitrary bytes', () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const round = base64ToBytes(bytesToBase64(original));
    expect(round).toEqual(original);
  });

  it('handles empty input', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('');
    expect(base64ToBytes('')).toEqual(new Uint8Array());
  });
});

describe('fileToResumeRecord / resumeRecordToFile', () => {
  it('preserves filename, mime type, and bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251]);
    const original = new File([bytes], 'cv.pdf', { type: 'application/pdf' });

    const record = await fileToResumeRecord(original);
    expect(record.filename).toBe('cv.pdf');
    expect(record.mimeType).toBe('application/pdf');
    expect(record.size).toBe(bytes.byteLength);

    const reborn = resumeRecordToFile(record);
    expect(reborn.name).toBe('cv.pdf');
    expect(reborn.type).toBe('application/pdf');
    expect(reborn.size).toBe(bytes.byteLength);

    const back = new Uint8Array(await reborn.arrayBuffer());
    expect(back).toEqual(bytes);
  });

  it('defaults mimeType when File.type is empty', async () => {
    const f = new File([new Uint8Array([0])], 'mystery.bin', { type: '' });
    const record = await fileToResumeRecord(f);
    expect(record.mimeType).toBe('application/octet-stream');
  });
});
