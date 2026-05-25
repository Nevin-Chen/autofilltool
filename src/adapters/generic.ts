/**
 * Generic adapter — the fallback. Walks all visible <input>/<select>/
 * <textarea> elements and classifies them with the shared heuristic
 * pipeline (autocomplete → input type → label keywords).
 *
 * Per-platform adapters (greenhouse.ts, lever.ts, ashby.ts) handle structured
 * markup first and only fall back to these heuristics for fields they don't
 * recognise.
 */

import type { PlatformAdapter, DetectedField } from './types';
import {
  classifyByHeuristics,
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
