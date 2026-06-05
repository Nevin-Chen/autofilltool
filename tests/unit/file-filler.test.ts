import { describe, expect, it, beforeEach } from 'vitest';
import { attachFile, isFileAlreadyAttached } from '@/content/filler';
import { findResumeInput } from '@/adapters/generic';

function makeFile(name = 'resume.pdf'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' });
}

describe('attachFile', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('rejects non-file inputs', () => {
    const input = document.createElement('input');
    input.type = 'text';
    const r = attachFile(input, makeFile(), { forceOverwrite: false });
    expect(r.status).toBe('error');
  });

  it('attaches a file and dispatches change', () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);

    let changes = 0;
    input.addEventListener('change', () => changes++);

    const r = attachFile(input, makeFile(), { forceOverwrite: false });
    expect(r.status).toBe('attached');
    expect(input.files?.length).toBe(1);
    expect(input.files?.[0]?.name).toBe('resume.pdf');
    expect(changes).toBe(1);
  });

  it('skips when the input already has a file (no forceOverwrite)', () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);

    // Pre-populate with a file.
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([9])], 'existing.pdf', { type: 'application/pdf' }));
    input.files = dt.files;

    const r = attachFile(input, makeFile('new.pdf'), { forceOverwrite: false });
    expect(r.status).toBe('skipped');
    expect(input.files?.[0]?.name).toBe('existing.pdf');
  });

  it('overwrites when forceOverwrite is true', () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([9])], 'existing.pdf', { type: 'application/pdf' }));
    input.files = dt.files;

    const r = attachFile(input, makeFile('new.pdf'), { forceOverwrite: true });
    expect(r.status).toBe('attached');
    expect(input.files?.[0]?.name).toBe('new.pdf');
  });
});

describe('findResumeInput', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('matches an input with a resume-shaped label', () => {
    document.body.innerHTML = `
      <label for="r">Upload your resume</label>
      <input id="r" type="file" name="resume" />
    `;
    const found = findResumeInput(document);
    expect(found).not.toBeNull();
    expect(found?.id).toBe('r');
  });

  it('matches via aria-label', () => {
    document.body.innerHTML = `
      <input type="file" aria-label="Attach CV" />
    `;
    const found = findResumeInput(document);
    expect(found).not.toBeNull();
  });

  it('falls back to the lone file input on the page', () => {
    document.body.innerHTML = `
      <label for="x">Document</label>
      <input id="x" type="file" name="doc" />
    `;
    const found = findResumeInput(document);
    expect(found?.id).toBe('x');
  });

  it('returns null when multiple non-resume file inputs exist', () => {
    document.body.innerHTML = `
      <input type="file" name="cover-letter" aria-label="Cover letter" />
      <input type="file" name="portfolio" aria-label="Portfolio" />
    `;
    const found = findResumeInput(document);
    expect(found).toBeNull();
  });

  it('skips disabled inputs', () => {
    document.body.innerHTML = `
      <input type="file" name="resume" disabled />
    `;
    const found = findResumeInput(document);
    expect(found).toBeNull();
  });
});

describe('isFileAlreadyAttached', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns false when no file inputs exist', () => {
    expect(isFileAlreadyAttached(document, makeFile())).toBe(false);
  });

  it('returns false when every file input is empty', () => {
    document.body.innerHTML = `
      <input type="file" name="resume" />
      <input type="file" name="cv" />
    `;
    expect(isFileAlreadyAttached(document, makeFile())).toBe(false);
  });

  it('returns true when one input holds a file matching name AND size', () => {
    const original = document.createElement('input');
    original.type = 'file';
    document.body.appendChild(original);
    attachFile(original, makeFile('resume.pdf'), { forceOverwrite: false });

    // The page swaps the original input for a fresh one (Greenhouse pattern).
    const swapped = document.createElement('input');
    swapped.type = 'file';
    swapped.id = 'fresh';
    document.body.appendChild(swapped);

    expect(isFileAlreadyAttached(document, makeFile('resume.pdf'))).toBe(true);
  });

  it('returns false when the populated input holds a different filename', () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);
    attachFile(input, makeFile('cover-letter.pdf'), { forceOverwrite: false });

    expect(isFileAlreadyAttached(document, makeFile('resume.pdf'))).toBe(false);
  });

  it('returns false when name matches but size differs (different document)', () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);
    const bigger = new File(
      [new Uint8Array([1, 2, 3, 4, 5, 6])],
      'resume.pdf',
      { type: 'application/pdf' },
    );
    attachFile(input, bigger, { forceOverwrite: false });

    expect(isFileAlreadyAttached(document, makeFile('resume.pdf'))).toBe(false);
  });
});
