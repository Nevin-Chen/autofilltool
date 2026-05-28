/**
 * Résumé → plain text extractor.
 *
 * Stored résumés are kept as base64-encoded bytes in chrome.storage.local
 * (see src/profile/resume.ts). When the AI Suggest feature builds a prompt
 * it needs that résumé as readable text — without that context the model
 * has nothing but the typed profile fields to ground answers in, which
 * produces the generic-feeling output reported by users.
 *
 * Supported MIME types:
 *   - `text/plain`            → decode base64 → UTF-8.
 *   - `application/pdf`       → pdfjs-dist (legacy build, no worker).
 *   - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
 *                             → mammoth.extractRawText.
 *   - `application/msword`    → mammoth (best-effort; mammoth's .doc
 *                               support is limited but better than nothing).
 *
 * For everything else we return a single-line placeholder so the prompt
 * builder can still print *something* — the model is then told the type
 * up front instead of seeing a binary blob.
 *
 * Why a dedicated module: these parsers (especially pdfjs-dist) are large
 * dependencies. Isolating them here keeps the rest of the codebase
 * dependency-light AND lets the test harness mock the dynamic imports
 * without dragging the parsers into every unrelated test's environment.
 *
 * Why ALL imports here are dynamic (`await import(...)`): MV3 service
 * workers cold-start on every wake. A static import on a 1MB pdf parser
 * adds latency to every message, even ones that don't need it. Dynamic
 * imports only load the parser when a résumé is actually being processed.
 */

import type { ResumeRecord } from '@/profile/schema';

/**
 * Cap on extracted text length. Roughly two-and-a-bit screens of prose —
 * enough for the model to pick up name, title, recent roles, key projects,
 * and skills, without crowding out the rest of the prompt budget.
 */
export const RESUME_CHAR_BUDGET = 6000;

/**
 * Maximum PDF pages we'll parse. Real résumés are 1–2 pages; capping
 * defends against a user uploading a long PDF (paper, slide deck) by
 * mistake, which would otherwise stall the prompt build.
 */
const PDF_MAX_PAGES = 20;

const MIME_PDF = 'application/pdf';
const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_DOC = 'application/msword';

/**
 * Async because PDF and DOCX parsers are async. Callers (currently
 * `buildPrompt` in client.ts) must await this.
 *
 * Never throws — on any extraction failure we return the same kind of
 * placeholder the legacy code did, so the prompt still builds cleanly.
 */
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
    // Soft fail: don't break the whole Suggest flow because the parser
    // tripped on a malformed file. Surface the failure to the console for
    // debugging; the prompt gets the placeholder.
    // eslint-disable-next-line no-console
    console.warn('[autofilltool] résumé text extraction failed:', err);
  }
  return placeholderFor(resume);
}

/* ----------------------------------------------------------- pdfjs-dist */

/**
 * Path of the bundled pdf.js worker, relative to the extension's package
 * root. Vite copies pdfjs-dist's worker file here at build time via the
 * `public/` mapping; the file is also listed in
 * `manifest.json#web_accessible_resources` so the service worker can
 * resolve a URL for it via `chrome.runtime.getURL`.
 *
 * Tests don't run in an extension, so they override `workerSrc` directly
 * (see tests/unit/resume-text.test.ts).
 */
const PDFJS_WORKER_PATH = 'pdf.worker.mjs';

async function extractPdf(b64: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // GlobalWorkerOptions is a process-global; set it once if not already
  // configured. Tests set it from their own setup; this branch runs in
  // the actual extension.
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
      // pdf.js's `transform` is a 6-tuple; index 5 is the y origin. Items
      // with the same y are on the same line — group them so multi-column
      // layouts don't collapse into nonsense.
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
  // mammoth ships separate node + browser entry points (see its
  // package.json `browser` field). They take different option keys:
  //   - browser/unzip.js → `{ arrayBuffer }`
  //   - lib/unzip.js     → `{ buffer }`
  // Vite resolves to the browser build for our service worker (ideal).
  // vitest resolves to the node build. Passing BOTH keys keeps the code
  // path identical — only one matches in each environment.
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
