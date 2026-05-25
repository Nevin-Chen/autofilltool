/**
 * Generic adapter. The fallback. Classifies form fields by combining the
 * signals every HTML form gives us:
 *
 *   - `autocomplete` (most reliable when present)
 *   - `type` attribute
 *   - the field's label text (via <label for>, wrapping <label>, or aria-labelledby)
 *   - `aria-label`
 *   - `name` and `id` attributes
 *   - `placeholder`
 *
 * Each candidate kind gets a 0..1 confidence score. The highest scorer wins.
 * We deliberately stay conservative: it's better to leave a field empty than
 * to type the wrong value into it.
 */

import type { PlatformAdapter, DetectedField, FieldKind } from './types';

export const genericAdapter: PlatformAdapter = {
  id: 'generic',
  name: 'Generic form',
  matches: () => true, // always — it's the fallback
  detectFields,
};

/* ---------------------------------------------------- public entry point */

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const els = root.querySelectorAll<HTMLElement>('input, select, textarea');

  for (const el of Array.from(els)) {
    if (!isFillable(el)) continue;
    const ctx = collectContext(el);
    const classified = classify(el, ctx);
    if (!classified) continue;
    out.push({ el, kind: classified.kind, label: ctx.label, confidence: classified.confidence });
  }

  // Resolve duplicates: if two fields claim the same kind (e.g., two email
  // boxes), prefer the higher-confidence one. The other stays in the list —
  // some forms genuinely ask for the same value twice (confirm email).
  return out;
}

/* ------------------------------------------------------- classification */

type Context = {
  label: string; // best label we could find
  haystack: string; // lowercased blob of label + aria + placeholder + name + id, for matching
  autocomplete: string;
  type: string;
};

type Classification = { kind: FieldKind; confidence: number };

function classify(el: HTMLElement, ctx: Context): Classification | null {
  // 1. autocomplete is by far the strongest signal — trust it.
  const fromAc = fromAutocomplete(ctx.autocomplete);
  if (fromAc) return { kind: fromAc, confidence: 0.95 };

  // 2. input[type=email|tel|url] is also a strong signal.
  if (el instanceof HTMLInputElement) {
    if (ctx.type === 'email') return { kind: 'email', confidence: 0.9 };
    if (ctx.type === 'tel') return { kind: 'phone', confidence: 0.9 };
    if (ctx.type === 'url') {
      // narrow further with label keywords
      if (/linkedin/.test(ctx.haystack))
        return { kind: 'linkedin', confidence: 0.85 };
      if (/github/.test(ctx.haystack)) return { kind: 'github', confidence: 0.85 };
      if (/portfolio|website|personal/.test(ctx.haystack))
        return { kind: 'portfolio', confidence: 0.8 };
      return { kind: 'otherLink', confidence: 0.5 };
    }
  }

  // 3. Textareas are open-ended unless they're clearly a cover letter.
  if (el instanceof HTMLTextAreaElement) {
    if (/cover\s*letter/.test(ctx.haystack))
      return { kind: 'coverLetter', confidence: 0.85 };
    return { kind: 'openEnded', confidence: 0.5 };
  }

  // 4. Fall back to keyword matching on the haystack.
  return fromKeywords(ctx.haystack);
}

/** Map a Web-standard autocomplete token to a FieldKind. */
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

/** Ordered list of patterns; first hit wins. */
const KEYWORD_RULES: ReadonlyArray<{ kind: FieldKind; re: RegExp; confidence: number }> = [
  // identity
  { kind: 'firstName', re: /\b(first[\s_-]*name|given[\s_-]*name|forename)\b/, confidence: 0.85 },
  { kind: 'lastName', re: /\b(last[\s_-]*name|family[\s_-]*name|surname)\b/, confidence: 0.85 },
  { kind: 'preferredName', re: /\b(preferred[\s_-]*name|nickname|goes by|name you go by)\b/, confidence: 0.8 },
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
  // demographics — keep low confidence; we only fill if user explicitly set values
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

function fromKeywords(haystack: string): Classification | null {
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(haystack)) return { kind: rule.kind, confidence: rule.confidence };
  }
  return null;
}

/* ------------------------------------------------------- DOM helpers */

function isFillable(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    // skip non-data inputs
    const skip = new Set([
      'hidden',
      'submit',
      'button',
      'image',
      'reset',
      'file',
      'color',
    ]);
    if (skip.has(el.type)) return false;
    return true;
  }
  if (el instanceof HTMLSelectElement) {
    return !el.disabled;
  }
  if (el instanceof HTMLTextAreaElement) {
    return !el.disabled && !el.readOnly;
  }
  return false;
}

function collectContext(el: HTMLElement): Context {
  const label = bestLabel(el);
  const aria = (el.getAttribute('aria-label') ?? '').trim();
  const placeholder = (el.getAttribute('placeholder') ?? '').trim();
  const name = (el.getAttribute('name') ?? '').trim();
  const id = (el.getAttribute('id') ?? '').trim();
  const autocomplete = (el.getAttribute('autocomplete') ?? '').trim().toLowerCase();
  const type = (el.getAttribute('type') ?? '').trim().toLowerCase();

  // For radios / checkboxes, the *group* label (typically a <legend> in a
  // <fieldset>, or an aria-labelled wrapper) tells us what the question is.
  // The wrapping <label> usually carries only the option text ("Yes"/"No").
  // Include the group label in the haystack so the classifier can see it.
  let groupLabel = '';
  if (
    el instanceof HTMLInputElement &&
    (el.type === 'radio' || el.type === 'checkbox')
  ) {
    groupLabel = groupLabelFor(el);
  }

  // Normalize: camelCase → spaced, snake/kebab → spaced, lowercase.
  const normalized = [groupLabel, label, aria, placeholder, name, id]
    .filter(Boolean)
    .map(normalize)
    .join(' ');
  return { label: groupLabel || label, haystack: normalized, autocomplete, type };
}

function groupLabelFor(el: HTMLInputElement): string {
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
  // role="radiogroup" pattern (no fieldset).
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

function normalize(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Best-effort label resolution. Tries, in order:
 *   1. aria-labelledby (whitespace-separated id list)
 *   2. <label for="id">
 *   3. Ancestor <label> wrapping the input
 *   4. The closest preceding label-like element (label, legend, p, span) in
 *      the same form-group container
 *   5. aria-label
 *   6. placeholder
 *   7. name attribute
 */
function bestLabel(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy && doc) {
    const texts: string[] = [];
    for (const id of labelledBy.split(/\s+/)) {
      const ref = doc.getElementById(id);
      if (ref) texts.push(textOf(ref));
    }
    const joined = texts.join(' ').trim();
    if (joined) return joined;
  }

  const id = el.getAttribute('id');
  if (id && doc) {
    // CSS.escape may not exist in jsdom variants; fall back to manual escape.
    const escaped =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(id)
        : id.replace(/(["\\#.:;,?!+*~'`()\[\]{}<>=|/])/g, '\\$1');
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

  // Climb a couple of ancestors looking for a label-ish sibling.
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

function textOf(node: Element): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}
