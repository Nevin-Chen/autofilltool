/**
 * Ashby adapter — a React SPA at `jobs.ashbyhq.com/<company>/<posting>`. Each
 * field is a `[data-testid="FieldEntry"]` block with its label in
 * `[data-testid="FieldLabel"]`. Walk every FieldEntry, classify by label
 * keywords, pair with the input inside; fall back to shared heuristics. The
 * resume FieldEntry wraps a raw `<input type="file">` under its drag-drop UI.
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
  clipJobDescription,
  pickJobDescriptionByCss,
  hasSubmissionConfirmText,
} from './_shared';

export const ashbyAdapter: PlatformAdapter = {
  id: 'ashby',
  name: 'Ashby',
  matches: (url, doc) => {
    if (/(^|\.)ashbyhq\.com$/.test(url.hostname)) return true;
    // Embeds: Ashby's data-testid attributes are distinctive.
    return !!doc.querySelector('[data-testid="FieldEntry"], [data-testid="FieldLabel"]');
  },
  detectFields,
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

/**
 * Ashby is an SPA: after submit it swaps the FieldEntry form for a confirmation
 * view in place. Match a known confirmation testid, else require the
 * confirmation copy with no FieldEntry blocks remaining.
 */
function detectSubmissionConfirmed(doc: Document, _url: URL): boolean {
  if (
    doc.querySelector(
      '[data-testid="application-confirmation"], [data-testid="ApplicationConfirmation"], [data-testid="submitted-application"]',
    )
  ) {
    return true;
  }
  const formGone = !doc.querySelector('[data-testid="FieldEntry"]');
  return formGone && hasSubmissionConfirmText(doc);
}

/** JD lives in `[data-testid="JobPostingDescription"]`; falls back to main, then body. */
function getJobDescription(doc: Document): string {
  const byCss = pickJobDescriptionByCss(doc, [
    '[data-testid="JobPostingDescription"]',
    '[data-testid="JobPostingPage"]',
    'main',
  ]);
  if (byCss) return byCss;
  if (doc.body) return clipJobDescription(doc.body.textContent ?? '');
  return '';
}

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  // 1. Walk FieldEntry blocks (one question each). Classify each input by
  //    keyword on the FieldLabel, else input-type. FieldLabel is reliable, so
  //    confidences sit above the generic baseline.
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

  // 2. Heuristics for anything outside FieldEntry blocks (defensive).
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
    // The FieldEntry labelled Resume/CV wraps the file input.
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
