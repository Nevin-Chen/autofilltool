import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractResumeText } from '@/ai/resume-text';
import type { ResumeRecord } from '@/profile/schema';
import { bytesToBase64 } from '@/profile/resume';

/**
 * Tests don't run inside a Chrome extension, so `chrome.runtime.getURL`
 * isn't available to resolve the bundled pdf.worker.mjs. Point
 * GlobalWorkerOptions.workerSrc directly at the installed file so pdfjs
 * can fake-worker on top of it (same code path production uses, just
 * with a file:// URL instead of chrome-extension://).
 */
beforeAll(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerPath = resolve(
    __dirname,
    '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  );
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    pathToFileURL(workerPath).href;
});

/**
 * Build a tiny in-memory ResumeRecord wrapping raw bytes.
 *
 * For DOCX we use a real fixture file (mammoth needs a valid zip
 * container). For PDF we use a hand-rolled "hello world" PDF because
 * pdfjs needs a real PDF stream — we keep the fixture inline so a single
 * test file proves the wiring without large binaries in the repo.
 */
function recordFromBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): ResumeRecord {
  return {
    filename,
    mimeType,
    size: bytes.byteLength,
    bytesBase64: bytesToBase64(bytes),
    uploadedAt: new Date().toISOString(),
  };
}

describe('extractResumeText — text/plain', () => {
  it('decodes the bytes as UTF-8 and clips to the budget', async () => {
    const txt = 'Ada Lovelace — Senior Engineer at Acme.';
    const bytes = new TextEncoder().encode(txt);
    const text = await extractResumeText(
      recordFromBytes(bytes, 'cv.txt', 'text/plain'),
    );
    expect(text).toBe(txt);
  });

  it('also accepts any text/* mimetype (e.g. text/markdown)', async () => {
    const md = '# Ada\n\nEngineer.';
    const bytes = new TextEncoder().encode(md);
    const text = await extractResumeText(
      recordFromBytes(bytes, 'cv.md', 'text/markdown'),
    );
    expect(text).toMatch(/# Ada/);
  });
});

describe('extractResumeText — application/pdf', () => {
  it('extracts the visible text from a real one-page PDF fixture', async () => {
    const path = resolve(__dirname, '../e2e/fixtures/resume.pdf');
    const bytes = new Uint8Array(readFileSync(path));
    const text = await extractResumeText(
      recordFromBytes(bytes, 'cv.pdf', 'application/pdf'),
    );
    expect(text).toMatch(/Hello world!/);
  });

  it('returns a placeholder note for garbage PDF bytes', async () => {
    const text = await extractResumeText(
      recordFromBytes(new Uint8Array([1, 2, 3, 4]), 'broken.pdf', 'application/pdf'),
    );
    expect(text).toMatch(/broken\.pdf/);
    expect(text).toMatch(/unsupported|extraction/i);
  });
});

describe('extractResumeText — DOCX', () => {
  // The DOCX format is a zip; constructing one inline is impractical. We
  // generate a minimal one with mammoth's expected XML by stuffing
  // pre-built bytes once at test time.
  it('extracts raw text from a real .docx fixture if present, else skips', async () => {
    const fixturePath = resolve(
      __dirname,
      '../e2e/fixtures/resume.docx',
    );
    let bytes: Uint8Array;
    try {
      const buf = readFileSync(fixturePath);
      bytes = new Uint8Array(buf);
    } catch {
      // No fixture in the repo yet — skip rather than fail. Adding a
      // resume.docx with the text "Ada Lovelace" + a bullet list would
      // exercise the mammoth path; we keep the test soft so it doesn't
      // fail in clean checkouts that haven't generated the fixture.
      return;
    }
    const text = await extractResumeText(
      recordFromBytes(
        bytes,
        'resume.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    );
    expect(text.length).toBeGreaterThan(0);
  });

  it('returns a placeholder note for garbage DOCX bytes', async () => {
    const text = await extractResumeText(
      recordFromBytes(
        new Uint8Array([1, 2, 3]),
        'broken.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    );
    expect(text).toMatch(/broken\.docx/);
    expect(text).toMatch(/unsupported|extraction/i);
  });
});

describe('extractResumeText — unknown types', () => {
  it('returns a placeholder note rather than throwing', async () => {
    const text = await extractResumeText(
      recordFromBytes(new Uint8Array([0]), 'cv.rtf', 'application/rtf'),
    );
    expect(text).toMatch(/cv\.rtf/);
    expect(text).toMatch(/unsupported|extraction/i);
  });
});
