import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractResumeText } from '@/ai/resume-text';
import type { ResumeRecord } from '@/profile/schema';
import { bytesToBase64 } from '@/profile/resume';

beforeAll(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerPath = resolve(
    __dirname,
    '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  );
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    pathToFileURL(workerPath).href;
});

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

describe('extractResumeText — cached extractedText', () => {
  it('returns extractedText verbatim and never invokes the parser', async () => {
    const record: ResumeRecord = {
      ...recordFromBytes(
        new Uint8Array([0, 1, 2, 3]),
        'cv.pdf',
        'application/pdf',
      ),
      extractedText: 'Ada Lovelace — Senior Engineer at Acme.',
    };
    const text = await extractResumeText(record);
    expect(text).toBe('Ada Lovelace — Senior Engineer at Acme.');
  });

  it('ignores a cached placeholder and falls through to byte extraction', async () => {
    const record: ResumeRecord = {
      ...recordFromBytes(
        new TextEncoder().encode('Ada Lovelace plain text résumé.'),
        'cv.txt',
        'text/plain',
      ),
      extractedText: '(cv.txt, text/plain, 0 bytes — text extraction unsupported for this type)',
    };
    const text = await extractResumeText(record);
    expect(text).toBe('Ada Lovelace plain text résumé.');
  });
});

describe('extractResumeText — section detection', () => {
  async function extractText(plain: string): Promise<string> {
    const bytes = new TextEncoder().encode(plain);
    return extractResumeText(recordFromBytes(bytes, 'cv.txt', 'text/plain'));
  }

  it('parses canonical ALL CAPS section headings into labelled blocks', async () => {
    const text = [
      'Ada Lovelace',
      'ada@example.com | linkedin.com/in/ada',
      '',
      'SUMMARY',
      'Distributed-systems engineer focused on storage and reliability.',
      '',
      'EXPERIENCE',
      'Senior Engineer, Acme Inc — Jan 2020 to present',
      '- Built a key-value store serving 10M QPS',
      '- Led a team of 5 engineers',
      '',
      'Engineer, Beta Co — Jun 2017 to Dec 2019',
      '- Shipped a React dashboard used by 50k customers',
      '',
      'SKILLS',
      'TypeScript, React, Python, Go, Kubernetes, PostgreSQL',
      '',
      'EDUCATION',
      'BSc Computer Science MIT 2017',
    ].join('\n');
    const out = await extractText(text);
    expect(out).toMatch(/## CONTACT\n[\s\S]*Ada Lovelace/);
    expect(out).toMatch(/## SUMMARY\n[\s\S]*Distributed-systems engineer/);
    expect(out).toMatch(/## EXPERIENCE\n[\s\S]*Senior Engineer, Acme Inc/);
    expect(out).toMatch(/## EXPERIENCE[\s\S]*Beta Co/);
    expect(out).toMatch(/## SKILLS\n[\s\S]*TypeScript, React/);
    expect(out).toMatch(/## EDUCATION\n[\s\S]*MIT/);
  });

  it('recognises Title Case headings and common aliases', async () => {
    const text = [
      'Work Experience',
      'Senior Engineer at Acme',
      '',
      'Technical Skills',
      'Go Rust Kubernetes',
      '',
      'Selected Projects',
      'autofilltool: Chrome extension for ATS forms',
    ].join('\n');
    const out = await extractText(text);
    expect(out).toMatch(/## EXPERIENCE\n[\s\S]*Senior Engineer at Acme/);
    expect(out).toMatch(/## SKILLS\n[\s\S]*Go Rust Kubernetes/);
    expect(out).toMatch(/## PROJECTS\n[\s\S]*autofilltool/);
  });

  it('emits sections in canonical order regardless of source order', async () => {
    const text = [
      'SKILLS',
      'TypeScript',
      '',
      'EXPERIENCE',
      'Engineer at Beta Co',
      '',
      'SUMMARY',
      'Engineer.',
    ].join('\n');
    const out = await extractText(text);
    const summary = out.indexOf('## SUMMARY');
    const exp = out.indexOf('## EXPERIENCE');
    const skills = out.indexOf('## SKILLS');
    expect(summary).toBeGreaterThan(-1);
    expect(exp).toBeGreaterThan(summary);
    expect(skills).toBeGreaterThan(exp);
  });

  it('caps an oversize experience section without dropping later sections', async () => {
    const big = Array.from(
      { length: 400 },
      (_, i) =>
        `- Bullet ${i} about shipping a feature with measurable impact`,
    ).join('\n');
    const text = `EXPERIENCE\n${big}\n\nSKILLS\nTypeScript, React, Python`;
    const out = await extractText(text);
    expect(out).toMatch(/## EXPERIENCE/);
    expect(out).toMatch(/## SKILLS\n[\s\S]*TypeScript, React, Python/);
    const expBlock = out.split('## EXPERIENCE')[1]!.split('## SKILLS')[0]!;
    expect(expBlock.length).toBeLessThanOrEqual(2900);
  });

  it('falls back to flat truncated text when no canonical headings are present', async () => {
    const out = await extractText('Just a one-liner with no sections.');
    expect(out).toBe('Just a one-liner with no sections.');
    expect(out).not.toMatch(/##/);
  });

  it('does not classify sentence-like lines as headings', async () => {
    const out = await extractText(
      'I gained experience leading projects, shipping features.',
    );
    expect(out).not.toMatch(/##/);
  });

  it('strips "Page N of M" footer lines', async () => {
    const text = [
      'EXPERIENCE',
      'Engineer at Acme',
      'Page 1 of 2',
      '- Built things',
    ].join('\n');
    const out = await extractText(text);
    expect(out).toMatch(/## EXPERIENCE/);
    expect(out).not.toMatch(/Page 1 of 2/);
    expect(out).toMatch(/Built things/);
  });
});
