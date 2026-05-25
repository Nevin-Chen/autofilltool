/**
 * Shared classification + DOM helpers used by every platform adapter.
 *
 * Per-platform adapters should:
 *   1. Use their own structured selectors first (cleaner than heuristics).
 *   2. Fall back to `classifyByHeuristics(el, ctx)` for anything unknown.
 *
 * The underscore prefix signals "internal to adapters/" — nothing outside
 * src/adapters/ imports this module directly.
 */

import type { FieldKind } from './types';
import { attachFile } from '@/content/filler';

/* ------------------------------------------------------- context */

export type Context = {
  /** Best human-readable label we could resolve. */
  label: string;
  /**
   * Lowercased, normalized blob of label + aria + placeholder + name + id
   * (+ fieldset legend for radios/checkboxes). Used for regex matching.
   */
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

  // Radios / checkboxes need the group label (the question) added to the
  // haystack — the wrapping <label> only carries the option text ("Yes"/"No").
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

/* ------------------------------------------------------- classification */

export type Classification = { kind: FieldKind; confidence: number };

/**
 * Classify an element by combining standard HTML signals. Pure: no DOM
 * mutation, no side effects. Returns null if no signal is confident enough.
 *
 * Per-platform adapters should call this AFTER their own structured-selector
 * lookups so the platform's explicit knowledge wins over heuristics.
 */
export function classifyByHeuristics(el: HTMLElement, ctx: Context): Classification | null {
  // 1. autocomplete is by far the strongest signal.
  const fromAc = fromAutocomplete(ctx.autocomplete);
  if (fromAc) return { kind: fromAc, confidence: 0.95 };

  // 2. input[type=email|tel|url].
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

  // 3. Textareas are open-ended unless they clearly say cover letter.
  if (el instanceof HTMLTextAreaElement) {
    if (/cover\s*letter/.test(ctx.haystack))
      return { kind: 'coverLetter', confidence: 0.85 };
    return { kind: 'openEnded', confidence: 0.5 };
  }

  // 4. Keyword matching on the haystack.
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

/** Ordered keyword rules; first hit wins. Exposed for tests + reuse. */
export const KEYWORD_RULES: ReadonlyArray<{
  kind: FieldKind;
  re: RegExp;
  confidence: number;
}> = [
  // identity
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
  // address
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
  // links
  { kind: 'linkedin', re: /\blinked[\s_-]?in\b/, confidence: 0.9 },
  { kind: 'github', re: /\bgit[\s_-]?hub\b/, confidence: 0.9 },
  { kind: 'twitter', re: /\b(twitter|x\.com|@handle)\b/, confidence: 0.75 },
  {
    kind: 'portfolio',
    re: /\b(portfolio|personal[\s_-]*(site|website)|website|homepage)\b/,
    confidence: 0.7,
  },
  // work auth
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
  // demographics — only filled if the user explicitly set values
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

/* ------------------------------------------------------- DOM helpers */

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
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

export function textOf(node: Element): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Best-effort label resolution. Tries, in order:
 *   1. aria-labelledby
 *   2. <label for="id">
 *   3. ancestor <label>
 *   4. closest label-ish element in a nearby form-group container
 *   5. aria-label / placeholder / name
 */
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
  return s.replace(/(["\\#.:;,?!+*~'`()\[\]{}<>=|/])/g, '\\$1');
}

/* ------------------------------------------------------- resume slot */

export const RESUME_HINTS = /\b(resume|résumé|cv|curriculum|attach.*resume|upload.*resume)\b/i;

/**
 * Generic resume-slot finder. Per-platform adapters can override with a
 * tighter selector (e.g., Greenhouse's #resume input).
 */
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
    if (onlyOne) return onlyOne;
  }
  return null;
}

/**
 * Convenience wrapper: pick a slot via `pickSlot` (or the default
 * `findResumeInput`) and attach the file via the safe filler. Returns true
 * if anything landed. Used as a fillResume default by per-platform adapters.
 */
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
