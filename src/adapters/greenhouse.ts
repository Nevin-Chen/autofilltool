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
} from './_shared';

const KNOWN_FIELDS: ReadonlyArray<{ field: string; kind: FieldKind; confidence: number }> = [
  { field: 'first_name', kind: 'firstName', confidence: 0.99 },
  { field: 'last_name', kind: 'lastName', confidence: 0.99 },
  { field: 'email', kind: 'email', confidence: 0.99 },
  { field: 'phone', kind: 'phone', confidence: 0.99 },
];

const LABEL_HINTS: ReadonlyArray<{ re: RegExp; kind: FieldKind; confidence: number }> = [
  { re: /linkedin/i, kind: 'linkedin', confidence: 0.95 },
  { re: /github/i, kind: 'github', confidence: 0.95 },
  { re: /(portfolio|personal website)/i, kind: 'portfolio', confidence: 0.85 },
  { re: /current company/i, kind: 'otherLink', confidence: 0.4 }, // low; user can ignore
];

export const greenhouseAdapter: PlatformAdapter = {
  id: 'greenhouse',
  name: 'Greenhouse',
  matches: (url, doc) => {
    if (/(^|\.)greenhouse\.io$/.test(url.hostname)) return true;
    return !!(
      doc.querySelector('form#application-form') ||
      doc.getElementById('grnhse_app') ||
      doc.getElementById('grnhse_iframe')
    );
  },
  detectFields,
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectSubmissionConfirmed(doc: Document, _url: URL): boolean {
  if (doc.getElementById('application_confirmation')) return true;
  const formGone = !doc.querySelector('form#application-form, #grnhse_app form');
  return formGone && hasSubmissionConfirmText(doc);
}

function getJobDescription(doc: Document): string {
  const byCss = pickJobDescriptionByCss(doc, [
    '#content .section-wrapper.page-centered',
    '#content',
    'main',
    'article',
  ]);
  if (byCss) return byCss;
  if (doc.body) return clipJobDescription(doc.body.textContent ?? '');
  return '';
}

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  for (const { field, kind, confidence } of KNOWN_FIELDS) {
    let el: HTMLElement | null = root.querySelector<HTMLElement>(
      `input[name="${field}"], select[name="${field}"], textarea[name="${field}"]`,
    );
    if (!el) {
      const byId = root.getElementById(field);
      if (byId instanceof HTMLElement) el = byId;
    }
    if (el && isFillable(el) && !seen.has(el)) {
      const label = textForLabel(root, el.id) || textOfNearbyLabel(el) || field;
      out.push({ el, kind, label, confidence });
      seen.add(el);
    }
  }

  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>(
      '[role="combobox"], [aria-haspopup="listbox"]',
    ),
  )) {
    if (seen.has(el)) continue;
    const ctx = collectContext(el);
    const hinted = LABEL_HINTS.find((h) => h.re.test(ctx.label) || h.re.test(ctx.haystack));
    const classified = hinted ?? classifyByHeuristics(el, ctx);
    if (!classified) continue;
    out.push({
      el,
      kind: classified.kind,
      label: ctx.label,
      confidence: classified.confidence,
      widget: 'virtualizedDropdown',
    });
    seen.add(el);
  }

  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>('input, select, textarea'),
  )) {
    if (seen.has(el)) continue;
    if (!isFillable(el)) continue;

    const ctx = collectContext(el);
    const hinted = LABEL_HINTS.find((h) => h.re.test(ctx.label) || h.re.test(ctx.haystack));
    if (hinted) {
      out.push({ el, kind: hinted.kind, label: ctx.label, confidence: hinted.confidence });
      continue;
    }
    const classified = classifyByHeuristics(el, ctx);
    if (!classified) continue;
    out.push({ el, kind: classified.kind, label: ctx.label, confidence: classified.confidence });
  }

  return out;
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  return attachResumeViaSlot(file, root, (d) => {
    const byName = d.querySelector<HTMLInputElement>(
      'input[type="file"][name*="resume" i], input[type="file"][name*="cv" i]',
    );
    if (byName && !byName.disabled) return byName;
    const byId = d.getElementById('resume');
    if (byId instanceof HTMLInputElement && byId.type === 'file' && !byId.disabled) {
      return byId;
    }
    return findResumeInput(d);
  });
}

function textForLabel(root: Document, forId: string): string {
  if (!forId) return '';
  const lbl = root.querySelector<HTMLLabelElement>(`label[for="${forId}"]`);
  return (lbl?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function textOfNearbyLabel(el: HTMLElement): string {
  const wrapping = el.closest('label');
  if (wrapping) {
    const t = (wrapping.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  let cursor: HTMLElement | null = el.parentElement;
  for (let depth = 0; cursor && depth < 3; depth++, cursor = cursor.parentElement) {
    const candidate = cursor.querySelector('label');
    if (candidate) {
      const t = (candidate.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
  }
  return '';
}
