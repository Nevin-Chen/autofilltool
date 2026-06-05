import type { FieldKind } from './types';
import { attachFile } from '@/content/filler';

export type Context = {
  label: string;
  haystack: string;
  autocomplete: string;
  type: string;
};

export function collectContext(el: HTMLElement): Context {
  const label = bestLabel(el);
  const aria = (el.getAttribute('aria-label') ?? '').trim();
  const placeholder = (el.getAttribute('placeholder') ?? '').trim();
  const name = (el.getAttribute('name') ?? '').trim();
  const id = (el.getAttribute('id') ?? '').trim();
  const autocomplete = (el.getAttribute('autocomplete') ?? '').trim().toLowerCase();
  const type = (el.getAttribute('type') ?? '').trim().toLowerCase();

  let groupLabel = '';
  if (
    el instanceof HTMLInputElement &&
    (el.type === 'radio' || el.type === 'checkbox')
  ) {
    groupLabel = groupLabelFor(el);
  }

  const haystack = [groupLabel, label, aria, placeholder, name, id]
    .filter(Boolean)
    .map(normalize)
    .join(' ');
  return { label: groupLabel || label, haystack, autocomplete, type };
}

export type Classification = { kind: FieldKind; confidence: number };

export function classifyByHeuristics(el: HTMLElement, ctx: Context): Classification | null {
  const fromAc = fromAutocomplete(ctx.autocomplete);
  if (fromAc) return { kind: fromAc, confidence: 0.95 };

  if (el instanceof HTMLInputElement) {
    if (ctx.type === 'email') return { kind: 'email', confidence: 0.9 };
    if (ctx.type === 'tel') return { kind: 'phone', confidence: 0.9 };
    if (ctx.type === 'url') {
      if (/linkedin/.test(ctx.haystack)) return { kind: 'linkedin', confidence: 0.85 };
      if (/github/.test(ctx.haystack)) return { kind: 'github', confidence: 0.85 };
      if (/portfolio|website|personal/.test(ctx.haystack))
        return { kind: 'portfolio', confidence: 0.8 };
      return { kind: 'otherLink', confidence: 0.5 };
    }
  }

  if (el instanceof HTMLTextAreaElement) {
    if (/cover\s*letter/.test(ctx.haystack))
      return { kind: 'coverLetter', confidence: 0.85 };
    return { kind: 'openEnded', confidence: 0.5 };
  }

  return fromKeywords(ctx.haystack);
}

function fromAutocomplete(value: string): FieldKind | null {
  switch (value) {
    case 'given-name':
      return 'firstName';
    case 'family-name':
      return 'lastName';
    case 'name':
      return 'fullName';
    case 'nickname':
      return 'preferredName';
    case 'email':
      return 'email';
    case 'tel':
    case 'tel-national':
      return 'phone';
    case 'street-address':
    case 'address-line1':
      return 'addressLine1';
    case 'address-line2':
      return 'addressLine2';
    case 'address-level2':
      return 'city';
    case 'address-level1':
      return 'region';
    case 'postal-code':
      return 'postalCode';
    case 'country':
    case 'country-name':
      return 'country';
    case 'url':
      return 'otherLink';
    default:
      return null;
  }
}

export const KEYWORD_RULES: ReadonlyArray<{
  kind: FieldKind;
  re: RegExp;
  confidence: number;
}> = [
  { kind: 'firstName', re: /\b(first[\s_-]*name|given[\s_-]*name|forename)\b/, confidence: 0.85 },
  { kind: 'lastName', re: /\b(last[\s_-]*name|family[\s_-]*name|surname)\b/, confidence: 0.85 },
  {
    kind: 'preferredName',
    re: /\b(preferred[\s_-]*name|nickname|goes by|name you go by)\b/,
    confidence: 0.8,
  },
  { kind: 'fullName', re: /\b(full[\s_-]*name|legal[\s_-]*name|your name)\b/, confidence: 0.75 },
  { kind: 'email', re: /\b(e[\s_-]?mail|email address)\b/, confidence: 0.85 },
  {
    kind: 'phone',
    re: /\b(phone|telephone|mobile|cell[\s_-]*phone|contact number)\b/,
    confidence: 0.8,
  },
  {
    kind: 'addressLine1',
    re: /\b(street|address[\s_-]*(line[\s_-]*)?1|address\b(?!.*2))\b/,
    confidence: 0.7,
  },
  {
    kind: 'addressLine2',
    re: /\b(address[\s_-]*(line[\s_-]*)?2|apt|apartment|suite|unit)\b/,
    confidence: 0.75,
  },
  { kind: 'city', re: /\b(city|town|locality)\b/, confidence: 0.8 },
  { kind: 'region', re: /\b(state|province|region|county)\b/, confidence: 0.75 },
  {
    kind: 'postalCode',
    re: /\b(zip|postal[\s_-]*code|post[\s_-]*code|postcode)\b/,
    confidence: 0.85,
  },
  { kind: 'country', re: /\bcountry\b/, confidence: 0.85 },
  { kind: 'linkedin', re: /\blinked[\s_-]?in\b/, confidence: 0.9 },
  { kind: 'github', re: /\bgit[\s_-]?hub\b/, confidence: 0.9 },
  { kind: 'twitter', re: /\b(twitter|x\.com|@handle)\b/, confidence: 0.75 },
  {
    kind: 'portfolio',
    re: /\b(portfolio|personal[\s_-]*(site|website)|website|homepage)\b/,
    confidence: 0.7,
  },
  {
    kind: 'authorizedToWorkInUS',
    re: /\b(authoriz(ed|ation)\s+to\s+work|legally\s+(allowed|authorized)\s+to\s+work|work authorization)\b/,
    confidence: 0.8,
  },
  {
    kind: 'requiresSponsorship',
    re: /\b(require|need|request).*\b(sponsor|sponsorship|visa)\b/,
    confidence: 0.8,
  },
  {
    kind: 'willingToRelocate',
    re: /\b(willing\s+to\s+relocate|open\s+to\s+relocation|relocate)\b/,
    confidence: 0.75,
  },
  {
    kind: 'desiredSalary',
    re: /\b(desired|expected|target).*\b(salary|compensation|pay)\b|salary[\s_-]*(expectation|range)/,
    confidence: 0.8,
  },
  { kind: 'gender', re: /\b(gender|sex)\b/, confidence: 0.65 },
  { kind: 'pronouns', re: /\bpronoun/, confidence: 0.7 },
  {
    kind: 'ethnicity',
    re: /\b(ethnicity|race|hispanic|latino|latina|latinx)\b/,
    confidence: 0.7,
  },
  { kind: 'veteranStatus', re: /\b(veteran|military)\b/, confidence: 0.7 },
  { kind: 'disabilityStatus', re: /\bdisab(ility|led)\b/, confidence: 0.7 },
];

export function fromKeywords(haystack: string): Classification | null {
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(haystack)) return { kind: rule.kind, confidence: rule.confidence };
  }
  return null;
}

export function isFillable(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    const skip = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'file', 'color']);
    if (skip.has(el.type)) return false;
    return true;
  }
  if (el instanceof HTMLSelectElement) return !el.disabled;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  return false;
}

export function normalize(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

export function textOf(node: Element): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function bestLabel(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy && doc) {
    const parts: string[] = [];
    for (const id of labelledBy.split(/\s+/)) {
      const ref = doc.getElementById(id);
      if (ref) parts.push(textOf(ref));
    }
    const joined = parts.join(' ').trim();
    if (joined) return joined;
  }

  const id = el.getAttribute('id');
  if (id && doc) {
    const escaped = cssEscape(id);
    const lbl = doc.querySelector<HTMLLabelElement>(`label[for="${escaped}"]`);
    if (lbl) {
      const t = textOf(lbl);
      if (t) return t;
    }
  }

  const wrapping = el.closest('label');
  if (wrapping) {
    const t = textOf(wrapping);
    if (t) return t;
  }

  let cursor: HTMLElement | null = el.parentElement;
  for (let depth = 0; cursor && depth < 4; depth++, cursor = cursor.parentElement) {
    const candidate =
      cursor.querySelector('label, legend') ??
      cursor.querySelector('.label, [class*="label" i]');
    if (candidate instanceof HTMLElement) {
      const t = textOf(candidate);
      if (t) return t;
    }
  }

  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();
  const name = el.getAttribute('name');
  if (name) return name.trim();
  return '';
}

export function groupLabelFor(el: HTMLInputElement): string {
  const fs = el.closest('fieldset');
  if (fs) {
    const legend = fs.querySelector('legend');
    if (legend) {
      const t = textOf(legend);
      if (t) return t;
    }
    const labelled = fs.getAttribute('aria-labelledby');
    if (labelled) {
      const doc = el.ownerDocument;
      const parts: string[] = [];
      for (const id of labelled.split(/\s+/)) {
        const ref = doc.getElementById(id);
        if (ref) parts.push(textOf(ref));
      }
      const joined = parts.join(' ').trim();
      if (joined) return joined;
    }
    const aria = fs.getAttribute('aria-label');
    if (aria) return aria.trim();
  }
  const group = el.closest('[role="radiogroup"]');
  if (group) {
    const labelled = group.getAttribute('aria-labelledby');
    if (labelled) {
      const doc = el.ownerDocument;
      const parts: string[] = [];
      for (const id of labelled.split(/\s+/)) {
        const ref = doc.getElementById(id);
        if (ref) parts.push(textOf(ref));
      }
      const joined = parts.join(' ').trim();
      if (joined) return joined;
    }
    const aria = group.getAttribute('aria-label');
    if (aria) return aria.trim();
  }
  return '';
}

export function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/(["\\#.:;,?!+*~'`()[\]{}<>=|/])/g, '\\$1');
}

export const JOB_DESCRIPTION_CHAR_BUDGET = 3000;

export function clipJobDescription(raw: string): string {
  const collapsed = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim()) // collapse inline runs per line
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (collapsed.length <= JOB_DESCRIPTION_CHAR_BUDGET) return collapsed;
  return collapsed.slice(0, JOB_DESCRIPTION_CHAR_BUDGET - 1).trimEnd() + '…';
}

export function pickJobDescriptionByCss(
  doc: Document,
  selectors: ReadonlyArray<string>,
): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const text = (el.textContent ?? '').trim();
    if (text.length === 0) continue;
    return clipJobDescription(text);
  }
  return '';
}

export const RESUME_HINTS = /\b(resume|résumé|cv|curriculum|attach.*resume|upload.*resume)\b/i;
const NON_RESUME_HINTS = /\b(cover\s*letter|transcript|portfolio|certificat|references?)\b/i;

export function findResumeInput(root: Document): HTMLInputElement | null {
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  for (const input of inputs) {
    if (input.disabled) continue;
    const ctx = collectContext(input);
    if (RESUME_HINTS.test(ctx.haystack)) return input;
    if (RESUME_HINTS.test(input.getAttribute('accept') ?? '')) return input;
  }
  const enabled = inputs.filter((i) => !i.disabled);
  if (enabled.length === 1) {
    const onlyOne = enabled[0];
    if (!onlyOne) return null;
    const ctx = collectContext(onlyOne);
    if (NON_RESUME_HINTS.test(ctx.haystack)) return null;
    return onlyOne;
  }
  return null;
}

export async function attachResumeViaSlot(
  file: File,
  root: Document,
  pickSlot: (root: Document) => HTMLInputElement | null = findResumeInput,
): Promise<boolean> {
  const slot = pickSlot(root);
  if (!slot) return false;
  const action = attachFile(slot, file, { forceOverwrite: false });
  return action.status === 'attached';
}

export const SUBMISSION_CONFIRM_RE =
  /(thank you for (your )?appl|application (has been |was )?(submitted|received|complete)|we['’]?(ve| have) received your application|thanks for applying|successfully submitted|your application is complete)/i;

export function hasSubmissionConfirmText(doc: Document): boolean {
  const text = (doc.body?.textContent ?? '').slice(0, 5000);
  return SUBMISSION_CONFIRM_RE.test(text);
}
