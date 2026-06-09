import type { PlatformAdapter, DetectedField, FieldKind } from './types';
import {
  classifyByHeuristics,
  collectContext,
  isFillable,
  attachResumeViaSlot,
  findResumeInput,
  clipJobDescription,
  pickJobDescriptionByCss,
  hasSubmissionConfirmText,
  defaultDetectAll,
} from './_shared';

const NAME_MAP: ReadonlyArray<{ name: string; kind: FieldKind; confidence: number }> = [
  { name: 'name', kind: 'fullName', confidence: 0.99 },
  { name: 'email', kind: 'email', confidence: 0.99 },
  { name: 'phone', kind: 'phone', confidence: 0.99 },
  { name: 'urls[LinkedIn]', kind: 'linkedin', confidence: 0.99 },
  { name: 'urls[GitHub]', kind: 'github', confidence: 0.99 },
  { name: 'urls[Portfolio]', kind: 'portfolio', confidence: 0.99 },
  { name: 'urls[Other]', kind: 'otherLink', confidence: 0.95 },
];

export const leverAdapter: PlatformAdapter = {
  id: 'lever',
  name: 'Lever',
  matches: (url, doc) => {
    if (/(^|\.)lever\.co$/.test(url.hostname)) return true;
    return !!doc.querySelector('form[action*="lever.co"], .lever-job-listing-page');
  },
  detectFields,
  detectAll: (root) => defaultDetectAll({ detectFields }, root),
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectSubmissionConfirmed(doc: Document, url: URL): boolean {
  if (/\/(thanks|confirmation)\b/i.test(url.pathname)) return true;
  if (doc.querySelector('.application-confirmation, [data-qa="confirmation"]')) return true;
  const formGone = !doc.querySelector(
    'form[action*="lever.co"], form[action*="/apply"], [data-qa="application-form"]',
  );
  return formGone && hasSubmissionConfirmText(doc);
}

function getJobDescription(doc: Document): string {
  const byCss = pickJobDescriptionByCss(doc, [
    '.posting-page .content',
    '.posting',
    '.section-wrapper.page-full-width',
    '.section.page-centered',
    'main',
  ]);
  if (byCss) return byCss;
  if (doc.body) return clipJobDescription(doc.body.textContent ?? '');
  return '';
}

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  for (const { name, kind, confidence } of NAME_MAP) {
    const el = root.querySelector<HTMLElement>(`[name="${cssAttrEscape(name)}"]`);
    if (el instanceof HTMLElement && isFillable(el)) {
      const ctx = collectContext(el);
      out.push({ el, kind, label: ctx.label || name, confidence });
      seen.add(el);
    }
  }

  const scope =
    root.querySelector('form[action*="lever.co"], form[action*="/apply"]') ?? root;
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('input, select, textarea'))) {
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
    const byName = d.querySelector<HTMLInputElement>('input[type="file"][name="resume"]');
    if (byName && !byName.disabled) return byName;
    return findResumeInput(d);
  });
}

function cssAttrEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1');
}
