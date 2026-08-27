import {
  ResumeRecordSchema,
  ResumeVariantSchema,
  type ResumeRecord,
  type ResumeVariant,
} from './schema';

export async function fileToResumeRecord(file: File): Promise<ResumeRecord> {
  const buf = await file.arrayBuffer();
  const bytesBase64 = bytesToBase64(new Uint8Array(buf));
  const record: ResumeRecord = {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    bytesBase64,
    uploadedAt: new Date().toISOString(),
  };
  return ResumeRecordSchema.parse(record);
}

export async function fileToResumeVariant(
  file: File,
  label?: string,
): Promise<ResumeVariant> {
  const base = await fileToResumeRecord(file);
  return ResumeVariantSchema.parse({
    ...base,
    id: crypto.randomUUID(),
    label: label?.trim() || labelFromFilename(file.name),
  });
}

export function labelFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Resume';
  return cleaned.length > 60 ? `${cleaned.slice(0, 59).trimEnd()}…` : cleaned;
}

export function resumeRecordToFile(record: ResumeRecord): File {
  const bytes = base64ToBytes(record.bytesBase64);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], record.filename, {
    type: record.mimeType,
    lastModified: Date.parse(record.uploadedAt) || Date.now(),
  });
}

export function resumeLibraryBytes(
  variants: ReadonlyArray<Pick<ResumeRecord, 'bytesBase64'>>,
): number {
  return variants.reduce((sum, v) => sum + v.bytesBase64.length, 0);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
