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

const FIELD_ENTRY_SELECTOR = '[data-field-entry-id], [data-testid="FieldEntry"]';
const FIELD_LABEL_SELECTOR =
  '.ashby-application-form-question-title, [data-testid="FieldLabel"]';

export const ashbyAdapter: PlatformAdapter = {
  id: 'ashby',
  name: 'Ashby',
  matches: (url, doc) => {
    if (/(^|\.)ashbyhq\.com$/.test(url.hostname)) return true;
    return !!doc.querySelector(`${FIELD_ENTRY_SELECTOR}, ${FIELD_LABEL_SELECTOR}`);
  },
  detectFields,
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectSubmissionConfirmed(doc: Document, _url: URL): boolean {
  if (
    doc.querySelector(
      '[data-testid="application-confirmation"], [data-testid="ApplicationConfirmation"], [data-testid="submitted-application"]',
    )
  ) {
    return true;
  }
  const formGone = !doc.querySelector(FIELD_ENTRY_SELECTOR);
  return formGone && hasSubmissionConfirmText(doc);
}

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

  const entries = root.querySelectorAll<HTMLElement>(FIELD_ENTRY_SELECTOR);
  for (const entry of Array.from(entries)) {
    const labelEl = entry.querySelector(FIELD_LABEL_SELECTOR);
    const labelText = labelEl ? textOf(labelEl) : '';
    if (!labelText) continue;
    const haystack = normalize(labelText);
    const hit = fromKeywords(haystack);

    const radios = entry.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    if (radios.length > 0) {
      const groupReps = new Map<string, HTMLInputElement>();
      for (const r of Array.from(radios)) {
        if (!r.name) continue;
        if (!groupReps.has(r.name)) groupReps.set(r.name, r);
      }
      if (hit) {
        for (const rep of groupReps.values()) {
          if (!isFillable(rep)) continue;
          out.push({
            el: rep,
            kind: hit.kind,
            label: labelText,
            confidence: Math.min(1, hit.confidence + 0.1),
          });
        }
      }
      for (const r of Array.from(radios)) seen.add(r);
    }

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
        } else if (el.type === 'text' && haystack === 'name') {
          kind = 'fullName';
          confidence = 0.8;
        }
      }

      if (kind) {
        out.push({ el, kind, label: labelText, confidence });
        seen.add(el);
      }
    }
  }

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
    const entries = d.querySelectorAll<HTMLElement>(FIELD_ENTRY_SELECTOR);
    for (const entry of Array.from(entries)) {
      const labelEl = entry.querySelector(FIELD_LABEL_SELECTOR);
      const label = labelEl ? textOf(labelEl) : '';
      if (/\b(resume|résumé|cv|curriculum)\b/i.test(label)) {
        const input = entry.querySelector<HTMLInputElement>('input[type="file"]');
        if (input && !input.disabled) return input;
      }
    }
    return findResumeInput(d);
  });
}
