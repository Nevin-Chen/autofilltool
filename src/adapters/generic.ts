/**
 * Generic adapter — the fallback. Walks all visible <input>/<select>/
 * <textarea> elements and classifies them with the shared heuristic
 * pipeline (autocomplete → input type → label keywords).
 *
 * Per-platform adapters (greenhouse.ts, lever.ts, ashby.ts) handle structured
 * markup first and only fall back to these heuristics for fields they don't
 * recognise.
 *
 * Job description extraction uses Mozilla's Readability library — the same
 * one Firefox's Reader View uses — which is purpose-built for stripping
 * chrome (nav, sidebar, footer, ads) and returning just the article body.
 * That's a much better signal than `<main>`/`<article>` heuristics for the
 * long tail of company career pages.
 */

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

export { findResumeInput }; // re-exported for tests

export const genericAdapter: PlatformAdapter = {
  id: 'generic',
  name: 'Generic form',
  matches: () => true, // always — the fallback
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

/**
 * Last-resort job-description extractor for arbitrary career pages.
 *
 * Strategy: clone the document (Readability is destructive), run Readability
 * on the clone, return its `textContent` clipped to the JD budget. If
 * Readability bails — common on short application-only pages with no
 * substantial prose — we fall back to `<main>` / `<article>` / body text.
 */
function getJobDescription(doc: Document): string {
  try {
    // Heuristic: skip Readability when the page clearly isn't an article.
    // It's a fast check; saves the cost of cloning the whole DOM on form-
    // only pages.
    if (isProbablyReaderable(doc)) {
      // Readability mutates the document it's given, so clone first.
      const clone = doc.cloneNode(true) as Document;
      const article = new Readability(clone).parse();
      if (article?.textContent) {
        const clipped = clipJobDescription(article.textContent);
        if (clipped) return clipped;
      }
    }
  } catch {
    // Readability throws on malformed HTML or in environments missing
    // some DOM APIs. Fall through to the simple selector path.
  }
  const main = doc.querySelector('main')?.textContent ?? '';
  if (main.trim()) return clipJobDescription(main);
  const article = doc.querySelector('article')?.textContent ?? '';
  if (article.trim()) return clipJobDescription(article);
  if (doc.body) return clipJobDescription(doc.body.textContent ?? '');
  return '';
}
