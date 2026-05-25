/**
 * Resume file helpers. Resumes are stored as base64 in chrome.storage.local
 * via the ResumeRecord envelope. At fill time we reconstitute a real File so
 * the page's <input type="file"> sees it as if the user had picked it.
 */

import { ResumeRecordSchema, type ResumeRecord } from './schema';

/**
 * Read a browser File into a ResumeRecord. The File is consumed via
 * arrayBuffer() and stored as base64 (chrome.storage.local can't hold Blobs).
 */
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
  // Validate before returning; safer than trusting upstream callers.
  return ResumeRecordSchema.parse(record);
}

/**
 * Rebuild a File from a stored record. Used by the content-side filler when
 * attaching the resume to <input type="file"> via a DataTransfer.
 */
export function resumeRecordToFile(record: ResumeRecord): File {
  const bytes = base64ToBytes(record.bytesBase64);
  // Copy into a fresh ArrayBuffer so the BlobPart type narrows to ArrayBuffer
  // (TS 5.5 typings reject the wider ArrayBufferLike from Uint8Array.buffer).
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], record.filename, {
    type: record.mimeType,
    lastModified: Date.parse(record.uploadedAt) || Date.now(),
  });
}

/* ------------------------------------------------------ base64 helpers */

/**
 * Browser-safe base64 encoding for binary data. Chunked because btoa on a
 * very long string can blow the stack in some engines.
 */
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
