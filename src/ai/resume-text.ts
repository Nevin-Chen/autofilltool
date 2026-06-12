import type { ResumeRecord } from '@/profile/schema';

export const RESUME_CHAR_BUDGET = 6000;

const PDF_MAX_PAGES = 20;

const MIME_PDF = 'application/pdf';
const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_DOC = 'application/msword';

export async function extractResumeText(resume: ResumeRecord): Promise<string> {
  if (resume.extractedText && !isResumePlaceholder(resume.extractedText)) {
    return resume.extractedText;
  }

  const mime = (resume.mimeType || '').toLowerCase();
  try {
    let raw: string | null = null;
    if (mime === 'text/plain' || mime.startsWith('text/')) {
      raw = decodeBase64Utf8(resume.bytesBase64);
    } else if (mime === MIME_PDF) {
      raw = await extractPdf(resume.bytesBase64);
    } else if (mime === MIME_DOCX || mime === MIME_DOC) {
      raw = await extractDocx(resume.bytesBase64);
    }
    if (raw === null) return placeholderFor(resume);
    return shapeForPrompt(raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[autofilltool] résumé text extraction failed:', err);
  }
  return placeholderFor(resume);
}

type SectionName =
  | 'contact'
  | 'summary'
  | 'experience'
  | 'skills'
  | 'projects'
  | 'education'
  | 'certifications'
  | 'awards'
  | 'publications';

const SECTION_BUDGETS: Record<SectionName, number> = {
  contact: 300,
  summary: 400,
  experience: 2800,
  skills: 800,
  projects: 800,
  education: 500,
  certifications: 200,
  awards: 100,
  publications: 100,
};

const SECTION_ORDER: SectionName[] = [
  'contact',
  'summary',
  'experience',
  'skills',
  'projects',
  'education',
  'certifications',
  'awards',
  'publications',
];

const SECTION_PATTERNS: Array<{ name: SectionName; re: RegExp }> = [
  {
    name: 'summary',
    re: /^(?:professional\s+|career\s+)?(?:summary|profile|objective|about(?:\s+me)?)\b/i,
  },
  {
    name: 'experience',
    re: /^(?:work\s+|professional\s+|relevant\s+|industry\s+|employment\s+)?(?:experience|history)\b|^employment\b/i,
  },
  {
    name: 'education',
    re: /^education(?:al)?\b|^academic(?:\s+background)?\b/i,
  },
  {
    name: 'skills',
    re: /^(?:technical\s+|core\s+|key\s+|relevant\s+)?(?:skills|technologies|tech\s+stack|competenc(?:y|ies)|expertise|proficienc(?:y|ies))\b/i,
  },
  {
    name: 'projects',
    re: /^(?:personal\s+|side\s+|select(?:ed)?\s+|notable\s+)?(?:projects|portfolio)\b/i,
  },
  {
    name: 'certifications',
    re: /^certifications?\b|^certs?\b|^licenses?\b/i,
  },
  { name: 'awards', re: /^awards?\b|^honors?\b|^achievements?\b/i },
  { name: 'publications', re: /^publications?\b|^papers?\b|^research\b/i },
];

function shapeForPrompt(raw: string): string {
  const cleaned = cleanResumeText(raw);
  const split = splitIntoSections(cleaned);
  if (split.detected.length === 0) {
    return truncate(cleaned, RESUME_CHAR_BUDGET);
  }
  return renderSections(split);
}

function cleanResumeText(raw: string): string {
  let s = raw.replace(/\r\n?/g, '\n');
  s = s.replace(/^[ \t]*Page\s+\d+(?:\s+of\s+\d+)?[ \t]*$/gim, '');
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function classifyHeadingLine(line: string): SectionName | null {
  const trimmed = line.trim().replace(/[:\-—_•*]+\s*$/, '').trim();
  if (!trimmed || trimmed.length > 40) return null;
  if (/[.!?,]/.test(trimmed)) return null;
  if (!/[A-Za-z]/.test(trimmed)) return null;
  for (const { name, re } of SECTION_PATTERNS) {
    if (re.test(trimmed)) return name;
  }
  return null;
}

type SplitResult = {
  detected: SectionName[];
  blocks: Record<SectionName, string>;
};

function splitIntoSections(cleaned: string): SplitResult {
  const lines = cleaned.split('\n');
  const buffers: Record<SectionName, string[]> = {
    contact: [],
    summary: [],
    experience: [],
    skills: [],
    projects: [],
    education: [],
    certifications: [],
    awards: [],
    publications: [],
  };
  let current: SectionName = 'contact';
  const detected = new Set<SectionName>();
  for (const line of lines) {
    const sect = classifyHeadingLine(line);
    if (sect) {
      current = sect;
      detected.add(sect);
      continue;
    }
    buffers[current].push(line);
  }
  const blocks = {} as Record<SectionName, string>;
  for (const name of SECTION_ORDER) {
    blocks[name] = buffers[name].join('\n').replace(/^\n+|\n+$/g, '');
  }
  return { detected: Array.from(detected), blocks };
}

function renderSections(split: SplitResult): string {
  const out: string[] = [];
  for (const name of SECTION_ORDER) {
    const content = split.blocks[name];
    if (!content || !content.trim()) continue;
    const header = name === 'contact' ? 'CONTACT' : name.toUpperCase();
    const trimmed = truncate(content.trim(), SECTION_BUDGETS[name]);
    out.push(`## ${header}\n${trimmed}`);
  }
  return out.join('\n\n');
}

const PDFJS_WORKER_PATH = 'pdf.worker.mjs';

async function extractPdf(b64: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
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
    parts.push('');
    chars += parts.reduce((n, p) => n + p.length, 0);
    if (chars >= RESUME_CHAR_BUDGET * 2) break;
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

type PdfDocument = {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{
      items: Array<{ str: string; hasEOL?: boolean; transform?: number[] }>;
    }>;
  }>;
};

async function extractDocx(b64: string): Promise<string> {
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

export const RESUME_PLACEHOLDER_MARKER = 'text extraction unsupported';

export function isResumePlaceholder(text: string): boolean {
  return text.includes(RESUME_PLACEHOLDER_MARKER);
}

function placeholderFor(r: ResumeRecord): string {
  return `(${r.filename}, ${r.mimeType || 'binary'}, ${r.size} bytes — ${RESUME_PLACEHOLDER_MARKER} for this type)`;
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
