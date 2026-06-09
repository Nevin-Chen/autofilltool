import { Readability, isProbablyReaderable } from '@mozilla/readability';
import type { PlatformAdapter, DetectedField } from './types';
import {
  classifyByHeuristics,
  clipJobDescription,
  collectContext,
  isFillable,
  attachResumeViaSlot,
  findResumeInput,
} from './_shared';

export { findResumeInput };

export const genericAdapter: PlatformAdapter = {
  id: 'generic',
  name: 'Generic form',
  matches: () => true,
  detectFields,
  fillResume: (file, root) => attachResumeViaSlot(file, root),
  getJobDescription,
};

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('input, select, textarea'))) {
    if (!isFillable(el)) continue;
    const ctx = collectContext(el);
    const classified = classifyByHeuristics(el, ctx);
    if (!classified) continue;
    out.push({ el, kind: classified.kind, label: ctx.label, confidence: classified.confidence });
  }
  return out;
}

function getJobDescription(doc: Document): string {
  try {
    if (isProbablyReaderable(doc)) {
      const clone = doc.cloneNode(true) as Document;
      const article = new Readability(clone).parse();
      if (article?.textContent) {
        const clipped = clipJobDescription(article.textContent);
        if (clipped) return clipped;
      }
    }
  } catch {
  }
  const main = doc.querySelector('main')?.textContent ?? '';
  if (main.trim()) return clipJobDescription(main);
  const article = doc.querySelector('article')?.textContent ?? '';
  if (article.trim()) return clipJobDescription(article);
  if (doc.body) return clipJobDescription(doc.body.textContent ?? '');
  return '';
}
