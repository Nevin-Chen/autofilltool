/**
 * Ashby adapter. Ashby's hosted job boards live at
 * `jobs.ashbyhq.com/<company>/<posting>` and are a React SPA. Field markup
 * is wrapped in `[data-testid="FieldEntry"]` blocks; the human-readable
 * label is in `[data-testid="FieldLabel"]` and the editable input lives in
 * `[data-testid="..."]` slots like `InputField`, `MultiSelect`, etc.
 *
 * Strategy: walk every FieldEntry, read its FieldLabel text, classify by
 * label keywords, then pair with the input inside that block. Fall back to
 * shared heuristics for anything we can't recognise.
 *
 * Resume slot: the FieldEntry whose label contains "Resume" wraps an
 * `<input type="file">` (Ashby's drag-drop component still exposes the raw
 * input under the hood).
 */

import type { PlatformAdapter, DetectedField, FieldKind } from './types';
import {
  classifyByHeuristics,
  collectContext,
  fromKeywords,
  isFillable,
  attachResumeViaSlot,
  findResumeInput,
  normalize,
  textOf,
} from './_shared';

export const ashbyAdapter: PlatformAdapter = {
  id: 'ashby',
  name: 'Ashby',
  matches: (url, doc) => {
    if (/(^|\.)ashbyhq\.com$/.test(url.hostname)) return true;
    // Ashby embeds: their data-testid attributes are distinctive.
    return !!doc.querySelector('[data-testid="FieldEntry"], [data-testid="FieldLabel"]');
  },
  detectFields,
  fillResume,
};

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  // 1. Walk FieldEntry blocks — each is one logical question + its inputs.
  //    Classification per input: (a) keyword match on FieldLabel,
  //    (b) input-type fallback (email/tel input, textarea → openEnded).
  //    Ashby's FieldLabel is structured + reliable, so confidences here can
  //    sit higher than the generic heuristic baseline.
  const entries = root.querySelectorAll<HTMLElement>('[data-testid="FieldEntry"]');
  for (const entry of Array.from(entries)) {
    const labelEl = entry.querySelector('[data-testid="FieldLabel"]');
    const labelText = labelEl ? textOf(labelEl) : '';
    if (!labelText) continue;
    const haystack = normalize(labelText);
    const hit = fromKeywords(haystack);

    const inputs = entry.querySelectorAll<HTMLElement>('input, select, textarea');
    for (const el of Array.from(inputs)) {
      if (!isFillable(el)) continue;
      if (seen.has(el)) continue;

      let kind: FieldKind | null = null;
      let confidence = 0;
      if (hit) {
        kind = hit.kind;
        confidence = Math.min(1, hit.confidence + 0.1);
      } else if (el instanceof HTMLTextAreaElement) {
        kind = /cover\s*letter/i.test(haystack) ? 'coverLetter' : 'openEnded';
        confidence = 0.7;
      } else if (el instanceof HTMLInputElement) {
        if (el.type === 'email') {
          kind = 'email';
          confidence = 0.95;
        } else if (el.type === 'tel') {
          kind = 'phone';
          confidence = 0.95;
        }
      }

      if (kind) {
        out.push({ el, kind, label: labelText, confidence });
        seen.add(el);
      }
    }
  }

  // 2. Fall back to the heuristic classifier for anything outside FieldEntry
  //    blocks (rare on Ashby, but defensive).
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('input, select, textarea'))) {
    if (seen.has(el)) continue;
    if (!isFillable(el)) continue;
    const ctx = collectContext(el);
    const classified = classifyByHeuristics(el, ctx);
    if (!classified) continue;
    out.push({ el, kind: classified.kind, label: ctx.label, confidence: classified.confidence });
  }

  return out;
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  return attachResumeViaSlot(file, root, (d) => {
    // Look for the FieldEntry whose label says "Resume" / "CV" and grab the
    // <input type="file"> inside it.
    const entries = d.querySelectorAll<HTMLElement>('[data-testid="FieldEntry"]');
    for (const entry of Array.from(entries)) {
      const labelEl = entry.querySelector('[data-testid="FieldLabel"]');
      const label = labelEl ? textOf(labelEl) : '';
      if (/\b(resume|résumé|cv|curriculum)\b/i.test(label)) {
        const input = entry.querySelector<HTMLInputElement>('input[type="file"]');
        if (input && !input.disabled) return input;
      }
    }
    return findResumeInput(d);
  });
}
