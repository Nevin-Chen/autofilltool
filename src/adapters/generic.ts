/**
 * Generic adapter — the fallback. Walks all fillable inputs and classifies
 * them via the shared heuristic pipeline (autocomplete → input type → label
 * keywords). JD extraction uses Mozilla's Readability (Firefox Reader View's
 * engine) to strip nav/sidebar/footer and return just the article body —
 * better than `<main>`/`<article>` for the long tail of career pages.
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
 * Last-resort JD extractor: run Readability on a clone (it's destructive),
 * clip its text to the JD budget; fall back to main/article/body when it bails
 * (common on form-only pages with no prose).
 */
function getJobDescription(doc: Document): string {
  try {
    // Cheap gate: skip the DOM clone when the page clearly isn't an article.
    if (isProbablyReaderable(doc)) {
      const clone = doc.cloneNode(true) as Document; // Readability mutates its input
      const article = new Readability(clone).parse();
      if (article?.textContent) {
        const clipped = clipJobDescription(article.textContent);
        if (clipped) return clipped;
      }
    }
  } catch {
    // Readability throws on malformed HTML / missing DOM APIs — use selectors.
  }
  const main = doc.querySelector('main')?.textContent ?? '';
  if (main.trim()) return clipJobDescription(main);
  const article = doc.querySelector('article')?.textContent ?? '';
  if (article.trim()) return clipJobDescription(article);
  if (doc.body) return clipJobDescription(doc.body.textContent ?? '');
  return '';
}
