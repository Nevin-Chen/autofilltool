import type { FieldKind, DetectedField, DetectionResult, UnclassifiedField } from './types';
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
    kind: 'cityAndRegion',
    re: /\bcity\b.*\b(state|province|region)\b|\b(state|province|region)\b.*\bcity\b/,
    confidence: 0.85,
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
    kind: 'addressLine2',
    re: /\b(address[\s_-]*(line[\s_-]*)?2|apt|apartment|suite|unit)\b/,
    confidence: 0.75,
  },
  {
    kind: 'addressLine1',
    re: /\b(street|address[\s_-]*(line[\s_-]*)?1|address)\b/,
    confidence: 0.7,
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
    kind: 'willingToRelocate',
    re: /\b(willing\s+to\s+relocate|open\s+to\s+relocation|relocat(e|ion)|commute)\b/,
    confidence: 0.75,
  },
  {
    kind: 'desiredSalary',
    re: /\b(desired|expected|target).*\b(salary|compensation|pay)\b|salary[\s_-]*(expectation|range)/,
    confidence: 0.8,
  },
  {
    kind: 'gradYear',
    re: /\b(grad(uation)?[\s_-]*(year|date)|year[\s_-]*of[\s_-]*graduation|completion[\s_-]*(year|date))\b/,
    confidence: 0.75,
  },
  {
    kind: 'fieldOfStudy',
    re: /\b(field[\s_-]*of[\s_-]*study|major|discipline|concentration|area[\s_-]*of[\s_-]*study)\b/,
    confidence: 0.75,
  },
  { kind: 'degree', re: /\b(degree|qualification)\b/, confidence: 0.7 },
  {
    kind: 'school',
    re: /\b(school|university|college|institution|alma[\s_-]*mater)\b/,
    confidence: 0.75,
  },
  { kind: 'gender', re: /\b(gender|sex)\b/, confidence: 0.65 },
  { kind: 'pronouns', re: /\bpronoun/, confidence: 0.7 },
  {
    kind: 'ethnicity',
    re: /\b(hispanic|latino|latina|latinx)\b/,
    confidence: 0.7,
  },
  { kind: 'race', re: /\brace\b/, confidence: 0.7 },
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
    return !isVisuallyHidden(el);
  }
  if (el instanceof HTMLSelectElement) return !el.disabled && !isVisuallyHidden(el);
  if (el instanceof HTMLTextAreaElement)
    return !el.disabled && !el.readOnly && !isVisuallyHidden(el);
  return false;
}

function isVisuallyHidden(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const inline = el.style;
  if (inline.display === 'none') return true;
  if (inline.visibility === 'hidden') return true;
  const view = el.ownerDocument.defaultView;
  if (view && typeof view.getComputedStyle === 'function') {
    const cs = view.getComputedStyle(el);
    if (cs.display === 'none') return true;
    if (cs.visibility === 'hidden') return true;
  }
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
    const t = pickUnclaimedLabel(cursor, el);
    if (t) return t;
  }

  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();
  const name = el.getAttribute('name');
  if (name) return name.trim();
  return '';
}

const DESCRIPTION_SELECTOR =
  '[class*="description" i], [class*="help" i], [class*="hint" i], [class*="sublabel" i], [class*="sub-label" i], [class*="subtext" i], [class*="instruction" i]';

const DESCRIPTION_MAX = 600;

export function fieldDescription(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const label = bestLabel(el);

  const describedBy = el.getAttribute('aria-describedby');
  if (describedBy && doc) {
    const parts: string[] = [];
    for (const id of describedBy.split(/\s+/)) {
      const ref = doc.getElementById(id);
      if (ref && !ref.contains(el)) parts.push(textOf(ref));
    }
    const cleaned = descriptionMinusLabel(parts.join(' '), label);
    if (cleaned) return clipDescription(cleaned);
  }

  let cursor: HTMLElement | null = el.parentElement;
  for (let depth = 0; cursor && depth < 3; depth++, cursor = cursor.parentElement) {
    if (depth > 0 && hasOtherFillableField(cursor, el)) break;
    for (const candidate of Array.from(
      cursor.querySelectorAll<HTMLElement>(DESCRIPTION_SELECTOR),
    )) {
      if (candidate.contains(el)) continue;
      if (candidate.querySelector('input, textarea, select')) continue;
      const cleaned = descriptionMinusLabel(textOf(candidate), label);
      if (cleaned.length >= 8) return clipDescription(cleaned);
    }
  }
  return '';
}

function descriptionMinusLabel(raw: string, label: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const l = label.replace(/\s+/g, ' ').trim();
  if (!l) return text;
  if (text === l) return '';
  if (l.includes(text)) return '';
  if (text.startsWith(l)) return text.slice(l.length).replace(/^[\s:*.\-–—]+/, '').trim();
  return text;
}

function clipDescription(s: string): string {
  if (s.length <= DESCRIPTION_MAX) return s;
  return s.slice(0, DESCRIPTION_MAX - 1).trimEnd() + '…';
}

function pickUnclaimedLabel(scope: HTMLElement, target: HTMLElement): string {
  const candidates = scope.querySelectorAll<HTMLElement>('label, legend');

  for (const candidate of Array.from(candidates)) {
    if (isExplicitlyForTarget(candidate, target)) {
      const t = textOf(candidate);
      if (t) return t;
    }
  }

  const positional = nearestPrecedingLabel(scope, target);
  if (positional) {
    const t = textOf(positional);
    if (t) return t;
  }

  if (hasOtherFillableField(scope, target)) return '';

  for (const candidate of Array.from(candidates)) {
    if (labelBelongsToDifferentField(candidate, target)) continue;
    const t = textOf(candidate);
    if (t) return t;
  }
  const classLabel = scope.querySelector<HTMLElement>('.label, [class*="label" i]');
  if (classLabel instanceof HTMLElement && !labelBelongsToDifferentField(classLabel, target)) {
    const t = textOf(classLabel);
    if (t) return t;
  }
  return '';
}

function nearestPrecedingLabel(scope: HTMLElement, target: HTMLElement): HTMLElement | null {
  const all = scope.querySelectorAll<HTMLElement>(
    'label, legend, input, textarea, select',
  );
  let lastLabel: HTMLElement | null = null;
  for (const el of Array.from(all)) {
    if (el === target) return lastLabel;
    if (el instanceof HTMLLabelElement || el.tagName === 'LEGEND') {
      lastLabel = el;
      continue;
    }
    if (el instanceof HTMLInputElement) {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'hidden' || t === 'submit' || t === 'button' || t === 'reset' || t === 'image')
        continue;
    }
    lastLabel = null;
  }
  return null;
}

function isExplicitlyForTarget(label: HTMLElement, target: HTMLElement): boolean {
  if (label instanceof HTMLLabelElement) {
    const forId = label.getAttribute('for');
    if (forId && forId === target.id) return true;
    const wrapped = label.querySelector('input, textarea, select');
    if (wrapped === target) return true;
  }
  const labelId = label.id;
  if (labelId) {
    const ariaLabelledBy = target.getAttribute('aria-labelledby');
    if (ariaLabelledBy && ariaLabelledBy.split(/\s+/).includes(labelId)) return true;
  }
  return false;
}

function hasOtherFillableField(scope: HTMLElement, target: HTMLElement): boolean {
  const fields = scope.querySelectorAll('input, textarea, select');
  for (const f of Array.from(fields)) {
    if (f === target) continue;
    if (f instanceof HTMLInputElement) {
      const t = (f.type || 'text').toLowerCase();
      if (t === 'hidden' || t === 'submit' || t === 'button' || t === 'reset' || t === 'image')
        continue;
    }
    return true;
  }
  return false;
}

function labelBelongsToDifferentField(label: HTMLElement, target: HTMLElement): boolean {
  if (label instanceof HTMLLabelElement) {
    const forId = label.getAttribute('for');
    if (forId && forId !== target.id) return true;
    const wrapped = label.querySelector('input, textarea, select');
    if (wrapped && wrapped !== target) return true;
  }
  const labelId = label.id;
  if (labelId) {
    const referrer = label.ownerDocument.querySelector(
      `[aria-labelledby~="${cssEscape(labelId)}"]`,
    );
    if (referrer && referrer !== target) return true;
  }
  return false;
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

export const COMPLIANCE_PATTERN =
  /race|ethnic|hispanic|latino|disab|veteran|military|sponsor|visa|work[- ]?auth|authoriz(ed|ation)?\s+to\s+work|h-?1b|green card|citizen/i;

export function isCompliancePattern(label: string): boolean {
  return COMPLIANCE_PATTERN.test(label);
}

export function findUnclassifiedFields(
  root: Document,
  classified: DetectedField[],
): UnclassifiedField[] {
  const claimed = new WeakSet<HTMLElement>();
  const claimedRadioNames = new Set<string>();
  for (const f of classified) {
    claimed.add(f.el);
    if (f.el instanceof HTMLInputElement && f.el.type === 'radio' && f.el.name) {
      claimedRadioNames.add(f.el.name);
    }
  }

  const out: UnclassifiedField[] = [];
  const seenRadioGroups = new Set<string>();
  const seenCheckboxEls = new WeakSet<HTMLElement>();

  const allCombos = Array.from(
    root.querySelectorAll<HTMLElement>('[role="combobox"], [aria-haspopup="listbox"]'),
  );
  const innermostCombos = allCombos.filter(
    (el) => !allCombos.some((other) => other !== el && el.contains(other)),
  );
  for (const trigger of innermostCombos) {
    if (claimed.has(trigger)) continue;
    if (!isVisibleForUnclassifiedDetection(trigger)) continue;
    const label = bestLabel(trigger);
    if (!label) continue;
    if (isWidgetSubcontrolLabel(label)) {
      claimed.add(trigger);
      continue;
    }
    out.push({ el: trigger, label, fieldType: 'combobox' });
    claimed.add(trigger);
  }

  const elements = root.querySelectorAll<HTMLElement>('input, select, textarea');
  for (const el of Array.from(elements)) {
    if (claimed.has(el)) continue;
    if (!isFillable(el)) continue;

    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const name = el.name;
      if (!name) continue;
      if (claimedRadioNames.has(name)) continue;
      if (seenRadioGroups.has(name)) continue;
      seenRadioGroups.add(name);
      const groupOptions = collectRadioGroupOptions(root, name);
      const label = groupQuestionLabel(el, groupOptions);
      if (!label) continue;
      out.push({ el, label, fieldType: 'radio', options: groupOptions });
      continue;
    }

    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      if (seenCheckboxEls.has(el)) continue;
      const boxes = collectCheckboxGroup(root, el);
      for (const b of boxes) seenCheckboxEls.add(b);

      if (boxes.length < 2) continue;
      const optionLabels = boxes
        .map((b) => bestLabel(b).trim())
        .filter((s) => s.length > 0);
      if (optionLabels.length < 2) continue;
      const label = groupQuestionLabel(el, optionLabels);
      if (!label || isConsentCheckboxLabel(label)) continue;
      out.push({ el, label, fieldType: 'checkbox', options: optionLabels });
      continue;
    }

    const label = bestLabel(el);
    if (!label) continue;

    if (el instanceof HTMLTextAreaElement) {
      out.push({ el, label, fieldType: 'textarea' });
      continue;
    }
    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options)
        .map((o) => (o.textContent ?? '').trim())
        .filter((t) => t.length > 0);
      out.push({ el, label, fieldType: 'select', options });
      continue;
    }
    if (el instanceof HTMLInputElement) {
      const skipTypes = new Set(['email', 'tel', 'url', 'number', 'date', 'password']);
      if (skipTypes.has(el.type)) continue;
      out.push({ el, label, fieldType: 'text' });
    }
  }

  return out;
}

export function unclassifiedFromDetected(field: DetectedField): UnclassifiedField | null {
  const { el, label } = field;
  if (!label) return null;
  if (field.widget === 'buttonGroup') {
    const options: string[] = [];
    if (el instanceof HTMLElement) {
      for (const b of Array.from(el.querySelectorAll<HTMLElement>('button'))) {
        const t = textOf(b).trim();
        if (t && !options.includes(t)) options.push(t);
      }
    }
    return { el, label, fieldType: 'buttongroup', options };
  }
  if (field.widget === 'virtualizedDropdown') {
    return { el, label, fieldType: 'combobox' };
  }
  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options)
      .map((o) => (o.textContent ?? '').trim())
      .filter((t) => t.length > 0);
    return { el, label, fieldType: 'select', options };
  }
  if (el instanceof HTMLTextAreaElement) {
    return { el, label, fieldType: 'textarea' };
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === 'radio') {
      const name = el.name;
      if (!name) return null;
      const options = collectRadioGroupOptions(el.ownerDocument, name);
      return { el, label, fieldType: 'radio', options };
    }
    if (el.type === 'checkbox') return null;
    const skipTypes = new Set([
      'email', 'tel', 'url', 'number', 'date', 'password', 'file', 'hidden',
    ]);
    if (skipTypes.has(el.type)) return null;
    return { el, label, fieldType: 'text' };
  }
  const role = el.getAttribute('role');
  if (role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') {
    return { el, label, fieldType: 'combobox' };
  }
  return null;
}

function collectRadioGroupOptions(root: Document, name: string): string[] {
  const radios = Array.from(
    root.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${cssEscape(name)}"]`,
    ),
  );
  const labels: string[] = [];
  for (const r of radios) {
    const id = r.id;
    let labelText = '';
    if (id) {
      const lbl = r.ownerDocument.querySelector<HTMLLabelElement>(
        `label[for="${cssEscape(id)}"]`,
      );
      if (lbl) labelText = textOf(lbl);
    }
    if (!labelText) {
      const wrap = r.closest('label');
      if (wrap) labelText = textOf(wrap);
    }
    if (!labelText) labelText = r.value || '';
    if (labelText) labels.push(labelText);
  }
  return labels;
}

const WIDGET_SUBCONTROL_LABEL_RE = /^(search|filter|find|query)$/i;

function isWidgetSubcontrolLabel(label: string): boolean {
  return WIDGET_SUBCONTROL_LABEL_RE.test(label.trim());
}

function isVisibleForUnclassifiedDetection(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return isFillable(el);
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
  return true;
}

const CONSENT_CHECKBOX_PATTERN =
  /\b(i\s+(agree|consent|certify|acknowledge|confirm|authorize|accept|understand|attest)|agree to|consent to|terms\s+(of|and)|privacy\s+policy|i\s+have\s+read|opt[- ]?in|subscribe)\b/i;

export function isConsentCheckboxLabel(label: string): boolean {
  return CONSENT_CHECKBOX_PATTERN.test(label);
}

export function groupQuestionLabel(
  rep: HTMLInputElement,
  optionLabels: string[],
): string {
  const lowerOptions = new Set(
    optionLabels.map((o) => o.trim().toLowerCase()).filter((s) => s.length > 0),
  );

  const viaGroup = groupLabelFor(rep);
  if (viaGroup && !lowerOptions.has(viaGroup.toLowerCase())) return viaGroup;

  const container = rep.closest<HTMLElement>(
    'fieldset, [role="radiogroup"], [role="group"]',
  );
  if (container) {
    const t = questionTitleWithin(container, lowerOptions);
    if (t) return t;
  }

  let cursor: HTMLElement | null = rep.parentElement;
  for (let depth = 0; cursor && depth < 4; depth++, cursor = cursor.parentElement) {
    const t = questionTitleWithin(cursor, lowerOptions);
    if (t) return t;
  }

  return bestLabel(rep);
}

function questionTitleWithin(scope: HTMLElement, lowerOptions: Set<string>): string {
  const candidates = scope.querySelectorAll<HTMLElement>('legend, label');
  for (const c of Array.from(candidates)) {
    if (c instanceof HTMLLabelElement && labelTargetsChoiceInput(c)) continue;
    const t = textOf(c);
    if (!t) continue;
    if (lowerOptions.has(t.toLowerCase())) continue;
    return t;
  }
  return '';
}

function labelTargetsChoiceInput(label: HTMLLabelElement): boolean {
  const forId = label.getAttribute('for');
  if (forId) {
    const ref = label.ownerDocument.getElementById(forId);
    if (
      ref instanceof HTMLInputElement &&
      (ref.type === 'radio' || ref.type === 'checkbox')
    ) {
      return true;
    }
  }
  return !!label.querySelector('input[type="radio"], input[type="checkbox"]');
}

export function collectCheckboxGroup(
  root: Document,
  el: HTMLInputElement,
): HTMLInputElement[] {
  const container = el.closest<HTMLElement>(
    'fieldset, [role="group"], [role="radiogroup"]',
  );
  let boxes: HTMLInputElement[];
  if (container) {
    boxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
  } else if (el.name) {
    boxes = Array.from(
      root.querySelectorAll<HTMLInputElement>(
        `input[type="checkbox"][name="${cssEscape(el.name)}"]`,
      ),
    );
  } else {
    boxes = [el];
  }
  return boxes.filter((b) => isFillable(b));
}

export function defaultDetectAll(
  adapter: { detectFields: (root: Document) => DetectedField[] },
  root: Document,
): DetectionResult {
  const classified = adapter.detectFields(root);
  const unclassified = findUnclassifiedFields(root, classified);
  return { classified, unclassified };
}
