/**
 * Résumé → plain text for the AI Suggest prompt. Résumés are stored as
 * base64 bytes (src/profile/resume.ts); the model needs readable text to
 * ground answers in beyond the typed profile fields.
 *
 * Handles text/plain (base64→UTF-8), PDF (pdfjs-dist), and DOC/DOCX
 * (mammoth); anything else gets a one-line placeholder. Parsers are heavy,
 * so they live here and are imported dynamically — MV3 workers cold-start
 * on every wake, and we only want to pay for pdfjs when a résumé is actually
 * parsed. Isolating them also lets tests mock the dynamic imports. Never
 * throws: extraction failure falls back to the placeholder.
 */

import type { ResumeRecord } from '@/profile/schema';

/** Extracted-text cap — ~2 screens, enough for name/roles/skills. */
export const RESUME_CHAR_BUDGET = 6000;

/** PDF page cap — résumés are 1–2 pages; guards against a stray long PDF. */
const PDF_MAX_PAGES = 20;

const MIME_PDF = 'application/pdf';
const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_DOC = 'application/msword';

export async function extractResumeText(resume: ResumeRecord): Promise<string> {
  const mime = (resume.mimeType || '').toLowerCase();
  try {
    if (mime === 'text/plain' || mime.startsWith('text/')) {
      const text = decodeBase64Utf8(resume.bytesBase64);
      return truncate(text.trim(), RESUME_CHAR_BUDGET);
    }
    if (mime === MIME_PDF) {
      const text = await extractPdf(resume.bytesBase64);
      return truncate(text, RESUME_CHAR_BUDGET);
    }
    if (mime === MIME_DOCX || mime === MIME_DOC) {
      const text = await extractDocx(resume.bytesBase64);
      return truncate(text, RESUME_CHAR_BUDGET);
    }
  } catch (err) {
    // Soft fail: a malformed file shouldn't break Suggest; use the placeholder.
    // eslint-disable-next-line no-console
    console.warn('[autofilltool] résumé text extraction failed:', err);
  }
  return placeholderFor(resume);
}

/* ----------------------------------------------------------- pdfjs-dist */

/**
 * Bundled pdf.js worker path (copied via `public/`, listed in manifest
 * `web_accessible_resources`). Tests override workerSrc directly.
 */
const PDFJS_WORKER_PATH = 'pdf.worker.mjs';

async function extractPdf(b64: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // GlobalWorkerOptions is a process-global; set workerSrc once (extension only).
  const opts = (pdfjs as { GlobalWorkerOptions?: { workerSrc?: string } })
    .GlobalWorkerOptions;
  if (opts && !opts.workerSrc) {
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.getURL === 'function'
    ) {
      opts.workerSrc = chrome.runtime.getURL(PDFJS_WORKER_PATH);
    }
  }
  const data = base64ToUint8Array(b64);
  const loadingTask = (
    pdfjs as unknown as {
      getDocument(opts: {
        data: Uint8Array;
        isEvalSupported?: boolean;
      }): { promise: Promise<PdfDocument> };
    }
  ).getDocument({
    data,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, PDF_MAX_PAGES);
  const parts: string[] = [];
  let chars = 0;
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let lineY: number | null = null;
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      // transform[5] is the y origin; same-y items share a line (keeps
      // multi-column layouts from collapsing).
      const t = item.transform;
      const y: number | null =
        Array.isArray(t) && typeof t[5] === 'number' ? t[5] : null;
      if (lineY !== null && y !== null && Math.abs(y - lineY) > 1) {
        parts.push(line.trim());
        line = '';
      }
      lineY = y;
      line += item.str;
      if (item.hasEOL) {
        parts.push(line.trim());
        line = '';
        lineY = null;
      } else if (!line.endsWith(' ')) {
        line += ' ';
      }
    }
    if (line.trim()) parts.push(line.trim());
    parts.push(''); // page break → blank line
    chars += parts.reduce((n, p) => n + p.length, 0);
    if (chars >= RESUME_CHAR_BUDGET * 2) break;
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Minimum surface area of the pdfjs.PDFDocumentProxy we touch. */
type PdfDocument = {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{
      items: Array<{ str: string; hasEOL?: boolean; transform?: number[] }>;
    }>;
  }>;
};

/* --------------------------------------------------------------- mammoth */

async function extractDocx(b64: string): Promise<string> {
  // mammoth's browser build wants `{ arrayBuffer }`, the node build `{ buffer }`.
  // Vite→browser, vitest→node; pass both so each env picks the key it needs.
  const mammothMod = (await import('mammoth')) as unknown as {
    extractRawText?: (opts: object) => Promise<{ value: string }>;
    default?: { extractRawText?: (opts: object) => Promise<{ value: string }> };
  };
  const extractRawText =
    mammothMod.extractRawText ?? mammothMod.default?.extractRawText;
  if (!extractRawText) {
    throw new Error('mammoth: extractRawText not found on imported module');
  }
  const bytes = base64ToUint8Array(b64);
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const result = await extractRawText({ arrayBuffer: buf, buffer: bytes });
  return result.value.trim();
}

/* ------------------------------------------------------------- helpers */

function placeholderFor(r: ResumeRecord): string {
  return `(${r.filename}, ${r.mimeType || 'binary'}, ${r.size} bytes — text extraction unsupported for this type)`;
}

function decodeBase64Utf8(b64: string): string {
  const bytes = base64ToUint8Array(b64);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
